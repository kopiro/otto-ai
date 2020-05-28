import dialogflow, { protos } from "@google-cloud/dialogflow";
import * as IOManager from "./iomanager";
import Translator from "../stdlib/translator";
import config from "../config";
import { extractWithPattern, replaceVariablesInStrings } from "../helpers";
import {
  Fulfillment,
  CustomError,
  AIAction,
  Language,
  InputParams,
  BufferWithExtension,
  Session as ISession,
} from "../types";
import { struct, Struct } from "pb-util";
import { Request, Response } from "express";
import { Log } from "./log";
import SpeechRecognizer from "../stdlib/speech-recognizer";
import Events from "events";
import { Session } from "../data";
import { SessionsClient, IntentsClient } from "@google-cloud/dialogflow/build/src/v2";
import Voice from "./voice";

type IDetectIntentResponse = protos.google.cloud.dialogflow.v2.IDetectIntentResponse;
type IEventInput = protos.google.cloud.dialogflow.v2.IEventInput;
type ITextInput = protos.google.cloud.dialogflow.v2.ITextInput;
type WebhookRequest = protos.google.cloud.dialogflow.v2.WebhookRequest;
type WebhookResponse = protos.google.cloud.dialogflow.v2.WebhookResponse;
type IQueryInput = protos.google.cloud.dialogflow.v2.IQueryInput;
type OutputAudioEncoding = protos.google.cloud.dialogflow.v2.OutputAudioEncoding;

const TAG = "AI";
const log = new Log(TAG);

export type AIConfig = {
  projectId: string;
  environment?: string;
};

class AI {
  config: AIConfig;

  dfSessionClient: SessionsClient = new dialogflow.SessionsClient();
  dfIntentsClient: IntentsClient = new dialogflow.IntentsClient();
  emitter: Events.EventEmitter = new Events.EventEmitter();

  dfIntentAgentPath: string;

  constructor(config: AIConfig) {
    this.config = config;
    this.dfIntentAgentPath = this.dfIntentsClient.agentPath(this.config.projectId);
  }

  async train(queryText: string, answer: string) {
    console.debug(TAG, "TRAIN request", { queryText, answer });
    const response = await this.dfIntentsClient.createIntent({
      parent: this.dfIntentAgentPath,
      languageCode: config().language,
      intent: {
        displayName: `M-TRAIN: ${queryText}`.substr(0, 100),
        trainingPhrases: [
          {
            type: "EXAMPLE",
            parts: [{ text: queryText }],
          },
        ],
        messages: [
          {
            text: {
              text: [answer],
            },
          },
        ],
        webhookState: "WEBHOOK_STATE_ENABLED",
      },
    });
    console.debug(TAG, "TRAIN response", response);
    return response;
  }

  /**
   * Transform a Fulfillment by making some edits based on the current session settings
   */
  async fulfillmentTransformerForSession(fulfillment: Fulfillment, session: ISession): Promise<Fulfillment> {
    if (!fulfillment) return;

    fulfillment.payload = fulfillment.payload || {};

    // If this fulfillment has already been transformed, let's skip this
    if (fulfillment.payload.transformerUid) {
      return fulfillment;
    }

    // Always translate fulfillment speech in the user language
    if (fulfillment.fulfillmentText) {
      if (session.getTranslateTo() !== config().language) {
        fulfillment.fulfillmentText = await Translator.translate(
          fulfillment.fulfillmentText,
          session.getTranslateTo(),
          config().language,
        );
        fulfillment.payload.translatedTo = session.getTranslateTo();
      } else if (fulfillment.payload.translateFrom) {
        fulfillment.fulfillmentText = await Translator.translate(
          fulfillment.fulfillmentText,
          session.getTranslateTo(),
          fulfillment.payload.translateFrom,
        );
        fulfillment.payload.translatedTo = session.getTranslateTo();
      }
    }

    fulfillment.payload.transformerUid = config().uid;
    fulfillment.payload.transformedAt = Date.now();

    return fulfillment;
  }

  /**
   * Get the session path suitable for DialogFlow
   */
  getDFSessionPath(session: ISession) {
    const dfSessionId = session.id.replace(/\//g, "_");
    if (!this.config.environment) {
      return this.dfSessionClient.projectAgentSessionPath(this.config.projectId, dfSessionId);
    }

    return this.dfSessionClient.projectAgentEnvironmentUserSessionPath(
      this.config.projectId,
      this.config.environment,
      "-",
      dfSessionId,
    );
  }

  /**
   * Transform an error into a fulfillment
   */
  actionErrorTransformer(body: IDetectIntentResponse, error: CustomError): Fulfillment {
    const fulfillment: Fulfillment = {};

    if (error.message) {
      const errMessage = error.message;
      const textInPayload = extractWithPattern(body.queryResult.fulfillmentMessages, `[].payload.error.${errMessage}`);
      if (textInPayload) {
        // If an error occurs, try to intercept this error
        // in the fulfillmentMessages that comes from DialogFlow
        let text = textInPayload;
        if (error.data) {
          text = replaceVariablesInStrings(text, error.data);
        }
        fulfillment.fulfillmentText = text;
      }
    }

    // Add anyway the complete error
    fulfillment.payload = { error };

    return fulfillment;
  }

  /**
   * Accept a Generation action and resolve all outputs
   */
  async generatorResolver(
    body: IDetectIntentResponse,
    fulfillmentGenerator: IterableIterator<Fulfillment>,
    session: ISession,
    bag: IOManager.IOBag,
  ): Promise<[Fulfillment, boolean][]> {
    console.info(TAG, "Using generator resolver", fulfillmentGenerator);

    const fulfillmentsAndOutputResults: [Fulfillment, boolean][] = [];

    for await (const fulfillment of fulfillmentGenerator) {
      let outputResult: boolean;
      let trFulfillment: Fulfillment;

      try {
        trFulfillment = await this.fulfillmentTransformerForSession(fulfillment, session);
        outputResult = await IOManager.output(trFulfillment, session, bag);
      } catch (err) {
        console.error(TAG, "error while executing action generator", err);
        trFulfillment = this.actionErrorTransformer(body, err);
        trFulfillment = await this.fulfillmentTransformerForSession(trFulfillment, session);
        outputResult = await IOManager.output(trFulfillment, session, bag);
      }

      fulfillmentsAndOutputResults.push([trFulfillment, outputResult]);
    }

    return fulfillmentsAndOutputResults;
  }

  /**
   * Transform a body from DialogFlow into a Fulfillment by calling the internal action
   */
  async actionResolver(
    actionName: string,
    body: Record<string, any>,
    session: ISession,
    bag: IOManager.IOBag,
  ): Promise<Fulfillment> {
    console.info(TAG, `calling action <${actionName}>`);

    let fulfillment: Fulfillment = null;

    try {
      const [pkgName, pkgAction = "index"] = actionName.split(".");

      // Special package names
      if (pkgName === "train") {
        this.train(body.queryResult.outputContexts[0].parameters.queryText, body.queryResult.queryText);
        return body.queryResult;
      }

      // TODO: avoid code injection
      const pkg = await import(`../packages/${pkgName}/${pkgAction}`);
      if (!pkg) {
        throw new Error(`Invalid action name <${actionName}>`);
      }

      const pkgAuthorizations = (pkg.authorizations || []) as IOManager.Authorizations[];
      const sessionAuthorizations = session.authorizations || [];
      for (const pkgAuth of pkgAuthorizations) {
        if (!sessionAuthorizations.includes(pkgAuth)) {
          throw new Error(`Missing ${pkgAuth} authorization for your session`);
        }
      }

      const pkgCallable = pkg.default as AIAction;
      const actionResult = await pkgCallable(body, session, bag);

      // Now check if this action is a Promise or a Generator
      if (actionResult.constructor.name === "GeneratorFunction") {
        // Call the generator async
        setImmediate(() => {
          this.generatorResolver(body, actionResult as IterableIterator<Fulfillment>, session, bag);
        });

        // And immediately resolve
        fulfillment = {
          payload: {
            handledByGenerator: true,
          },
        };
      } else {
        if (typeof actionResult === "string") {
          fulfillment = { fulfillmentText: actionResult };
        } else {
          fulfillment = actionResult as Fulfillment;
        }
      }
    } catch (err) {
      console.error(TAG, "error while executing action:", err);
      fulfillment = this.actionErrorTransformer(body, err);
    }

    return fulfillment;
  }

  /**
   * Transform a text request to make it compatible and translating it
   */
  async textRequestTransformer(text: InputParams["text"], session: ISession): Promise<ITextInput> {
    const trText: ITextInput = {};

    if (config().language !== session.getTranslateTo()) {
      trText.text = await Translator.translate(text, config().language, session.getTranslateTo());
    } else {
      trText.text = text;
    }

    trText.languageCode = session.getTranslateTo();

    return trText;
  }

  /**
   * Transform an event by making compatible
   */
  async eventRequestTransformer(event: InputParams["event"], session: ISession): Promise<IEventInput> {
    let trEvent: IEventInput;

    if (typeof event === "string") {
      trEvent = { name: event };
    } else {
      trEvent = { name: event.name, parameters: event.parameters ? struct.encode(event.parameters) : {} };
    }

    trEvent.languageCode = session.getTranslateTo();

    return trEvent;
  }

  /**
   * Returns a valid audio buffer
   */
  outputAudioParser(body: IDetectIntentResponse): BufferWithExtension | null {
    // If there's no audio in the response, skip
    if (!body.outputAudio) {
      return null;
    }

    const payloadLanguageCode = body.queryResult.webhookPayload
      ? (struct.decode(body.queryResult.webhookPayload as Struct).language as Language)
      : null;

    // If the voice language doesn't match the session language, skip
    if (payloadLanguageCode && config().language !== payloadLanguageCode) {
      console.warn(TAG, "deleting outputAudio because of a voice language mismatch");
      return null;
    }

    return {
      buffer: body.outputAudio,
      extension: config().audio.extension,
    };
  }

  /**
   * Parse the DialogFlow webhook response
   */
  webhookResponseToFulfillment(body: IDetectIntentResponse, session: ISession): Fulfillment {
    if (body.webhookStatus?.code > 0) {
      return {
        payload: {
          error: {
            message: body.webhookStatus.message,
          },
        },
      };
    }

    return {
      fulfillmentText: body.queryResult.fulfillmentText,
      audio: this.outputAudioParser(body),
      payload: body.queryResult.webhookPayload ? struct.decode(body.queryResult.webhookPayload as Struct) : null,
    };
  }

  /**
   * Parse the DialogFlow body and decide what to do
   */
  async bodyParser(
    body: IDetectIntentResponse | WebhookRequest,
    session: ISession,
    bag: IOManager.IOBag,
  ): Promise<Fulfillment> {
    const parsedFromWebhook = "webhookStatus" in body && body.webhookStatus.code === 0;

    if (config().mimicOfflineServer) {
      console.warn(TAG, "!!! Miming an offline webhook server !!!");
    } else {
      if (parsedFromWebhook) {
        console.debug(TAG, "using response already parsed by the webhook");
        log.write(session.id, "body_parser_parsed_from_webhook", body);
        return this.webhookResponseToFulfillment(body as IDetectIntentResponse, session);
      }
    }

    log.write(session.id, "body_parser", body);

    // If we have an "action", call the package with the specified name
    if (body.queryResult.action) {
      console.debug(TAG, `Resolving action <${body.queryResult.action}>`);
      return this.actionResolver(body.queryResult.action, body, session, bag);
    }

    // Otherwise, check if at least an intent is match and direct return that fulfillment
    if (body.queryResult.intent) {
      console.debug(TAG, "Using body.queryResult object (matched from intent)", body.queryResult, parsedFromWebhook);

      // If the intent is a fallback intent, invoke a procedure to ask to be trained
      if (body.queryResult.intent.isFallback) {
        console.debug(TAG, `Training invoked`);
        setImmediate(async () => {
          if (config().trainingSessionId) {
            const trainingSession = await IOManager.getSession(config().trainingSessionId);
            this.processInput(
              {
                event: { name: "training", parameters: { queryText: body.queryResult.queryText } },
              },
              trainingSession,
            );
          }
        });
      }

      return {
        fulfillmentText: body.queryResult.fulfillmentText,
        // Do not add this property when we're parsing this response on the webhook
        audio: parsedFromWebhook ? this.outputAudioParser(body) : null,
      };
    }

    // If not intentId is returned, this is a unhandled DialogFlow intent
    // So make another event request to inform user (ai_unhandled)
    console.info(TAG, "Using ai_unhandled followupEventInput");
    return {
      followupEventInput: {
        name: "ai_unhandled",
      },
    };
  }

  async request(queryInput: IQueryInput, session: ISession, bag?: IOManager.IOBag): Promise<IDetectIntentResponse> {
    const payload = {
      session: this.getDFSessionPath(session),
      queryInput,
      queryParams: {
        payload: bag?.encodable ? struct.encode(bag.encodable) : {},
        sentimentAnalysisRequestConfig: {
          analyzeQueryTextSentiment: true,
        },
      },
      outputAudioConfig: {
        audioEncoding: (`OUTPUT_AUDIO_ENCODING_${config().audio.encoding}` as unknown) as OutputAudioEncoding,
      },
    };
    const response = await this.dfSessionClient.detectIntent(payload);
    log.write(session.id, "sent_detect_intent", payload);

    return response[0] as IDetectIntentResponse;
  }

  /**
   * Make a text request to DialogFlow and let the flow begin
   */
  async textRequest(_text: string, session: ISession, bag: IOManager.IOBag): Promise<Fulfillment> {
    console.info(TAG, "text request:", _text);

    const text = await this.textRequestTransformer(_text, session);
    const response = await this.request({ text }, session, bag);
    const fulfillment = await this.bodyParser(response, session, bag);
    return fulfillment;
  }

  /**
   * Make an event request to DialogFlow and let the flow begin
   */
  async eventRequest(_event: InputParams["event"], session: ISession, bag: IOManager.IOBag): Promise<Fulfillment> {
    console.info(TAG, "event request:", _event);

    const event = await this.eventRequestTransformer(_event, session);
    const response = await this.request({ event }, session, bag);
    const fulfillment = await this.bodyParser(response, session, bag);
    return fulfillment;
  }

  /**
   * The endpoint closure used by the webhook
   */
  async webhookEndpoint(req: Request, res: Response) {
    console.info(TAG, "[WEBHOOK]", "received request");

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: "ERR_EMPTY_BODY",
      });
    }

    const body = req.body as WebhookRequest;

    const sessionId = (body.session as string).split("/").pop();
    const session = (await IOManager.getSession(sessionId)) || (await IOManager.registerSession("webhook", sessionId));

    let fulfillment = await this.bodyParser(body, session, body.originalDetectIntentRequest?.payload);
    fulfillment = await this.fulfillmentTransformerForSession(fulfillment, session);
    fulfillment.outputContexts = body.queryResult.outputContexts;

    // Trick to use Google-Home only for recording, but forwarding output to my speaker
    // if (body.originalDetectIntentRequest?.source === "google") {
    //   IOManager.output(fulfillment, await IOManager.getSession("ottohome-human"));
    //   response.fulfillmentText = "  ";
    // }

    console.info(TAG, "[WEBHOOK]", "output", fulfillment);
    return res.status(200).json(fulfillment);
  }

  /**
   * Process a fulfillment to a session
   */
  async processInput(params: InputParams, session: ISession) {
    console.info(TAG, "processInput", { params, "session.id": session.id });

    if (session.repeatModeSession && params.text) {
      console.info(TAG, "using repeatModeSession", session.repeatModeSession);
      const fulfillment = await this.fulfillmentTransformerForSession(
        { fulfillmentText: params.text },
        session.repeatModeSession,
      );
      return IOManager.output(fulfillment, session.repeatModeSession, params.bag);
    }

    IOManager.writeLogForSession(params, session);

    let fulfillment: any = null;
    if (params.text) {
      fulfillment = await this.textRequest(params.text, session, params.bag);
    } else if (params.event) {
      fulfillment = await this.eventRequest(params.event, session, params.bag);
    } else if (params.audio) {
      const text = await SpeechRecognizer.recognizeFile(params.audio, session.getTranslateFrom());
      fulfillment = await this.textRequest(text, session, params.bag);
    } else {
      console.warn("Neither { text, event, audio } in params are not null");
    }

    fulfillment = await this.fulfillmentTransformerForSession(fulfillment, session);
    return IOManager.output(fulfillment, session, params.bag);
  }
}

export default new AI(config().dialogflow);
