import Events from "events";
import config from "../config";
import * as IOManager from "../stdlib/iomanager";
import Voice from "../stdlib/voice";
import { Fulfillment, Session, InputParams } from "../types";
import { Request, Response } from "express";
import { routerIO } from "../stdlib/server";
import { getTmpFile } from "../helpers";
import fs from "fs";
import bodyParser from "body-parser";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const formidable = require("formidable");

const TAG = "IO.Web";
const DRIVER_ID = "web";

type WebConfig = {};
type WebBag = {
  req: Request;
  res: Response;
};

enum AcceptHeader {
  TEXT = "text",
  AUDIO = "audio",
}

class Web implements IOManager.IODriverModule {
  config: WebConfig;
  emitter: Events.EventEmitter;
  started = false;

  constructor(config) {
    this.config = config;
    this.emitter = new Events.EventEmitter();
  }

  async requestEndpoint(req: Request, res: Response) {
    const sessionId = req.body.sessionId;
    const session = await IOManager.registerSession(DRIVER_ID, sessionId, req.headers);
    const bag: WebBag = { req, res };

    // First check if the request contains any text
    if (req.body.text) {
      const text = req.body.text;
      this.emitter.emit("input", {
        session,
        params: {
          text,
          bag,
        } as InputParams,
      });
      return true;
    }

    // Otherwise, parse for incoming audio
    const form = formidable();
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ files });
      });
    });

    if (files.audio) {
      const audioFile = getTmpFile("wav");
      fs.renameSync(files.audio.path, audioFile);
      this.emitter.emit("input", {
        session,
        params: {
          audio: audioFile,
          bag,
        } as InputParams,
      });
      return true;
    }

    throw new Error("Unable to find a suitable input");
  }

  async start() {
    if (this.started) return true;
    this.started = true;

    // Attach the route
    routerIO.post("/web", bodyParser.json(), async (req, res) => {
      try {
        await this.requestEndpoint(req, res);
      } catch (err) {
        res.status(400).json({ error: { message: err.message } });
      }
    });

    return true;
  }

  async output(fulfillment: Fulfillment, session: Session, bag: WebBag) {
    const results = [];

    const { req, res } = bag;
    const jsonResponse: Record<string, any> = {
      text: fulfillment.text,
    };

    if (req.headers["x-accept"] === AcceptHeader.AUDIO) {
      jsonResponse.audio = (await Voice.getFile(fulfillment.text)).getRelativePath();
    }

    res.json(jsonResponse);

    results.push(["response", jsonResponse]);
    return results;
  }
}

export default new Web(config().web);
