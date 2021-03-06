import config from "../../config";
import Translator from "../../stdlib/translator";

export const id = "translate.text";

export default async function main({ queryResult }) {
  const { parameters: p } = queryResult;

  const languages = await Translator.getLanguages(config().language);
  const language = languages.find((e) => e.name === p.language);

  if (!language) {
    return {
      fulfillmentText: `Non riconosco questa lingua: ${p.language}`,
    };
  }

  const text = await Translator.translate(p.q, language.code, config().language);
  return {
    fulfillmentText: text,
    payload: {
      includeVoice: true,
      language: language.code,
    },
  };
}
