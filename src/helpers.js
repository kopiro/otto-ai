const uuid = require('uuid');
const _ = require('underscore');
const diacriticsRemove = require('diacritics').remove;
const request = require('request');
const fs = require('fs');
const md5 = require('md5');

/**
 * Require a module or return null if not found
 * @param {String} e
 */
global.requireOrNull = function(e) {
	try {
		return require(e);
	} catch (ex) {
		console.error(`Unable to require: ${e}`);
		return null;
	}
};

/**
 * Pick a random element in an array
 * @param {Array} e
 */
global.rand = function(e) {
	return _.isArray(e) ? e[_.random(0, e.length - 1)] : e;
};

/**
 * Require a module from our internal library
 * @param {String} e
 */
global.apprequire = global.requireLibrary = function(e) {
	return require(__basedir + '/src/lib/' + e);
};

/**
 * Require an interface
 * @param {String} e
 */
global.requireInterface = function(e) {
	return require(__basedir + '/src/interfaces/' + e);
};

/**
 * Require a module from our helpers library
 * @param {String} e
 */
global.requireHelper = function(e) {
	return require(__basedir + '/src/helpers/' + e);
};

/**
 * Timeout using promises
 * @param {Number} ms
 */
global.timeout = function(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Generate a UUID v4
 */
global.uuid = function() {
	return uuid.v4();
};

/**
 * Clean text by removing diacritics and lowering its case
 * @param {String} t
 */
global.cleanText = function(t) {
	return diacriticsRemove(t).toLowerCase();
};

/**
 * Split a text using a pattern to mimic a message sent by a human
 * @param {String} text
 */
global.mimicHumanMessage = function(text) {
	const splitted = text.split(/\\n|\n|\.(?=\s+|[A-Z])/);
	return _.compact(splitted);
};

/**
 * Get the locale string from a language
 * Valid return values: cy-GB | da-DK | de-DE | en-AU | en-GB | en-GB-WLS | en-IN | en-US | es-ES | es-US | fr-CA | fr-FR | is-IS | it-IT | ja-JP | nb-NO | nl-NL | pl-PL | pt-BR | pt-PT | ro-RO | ru-RU | sv-SE | tr-TR
 * @param {String} language
 * @returns {String}
 */
global.getLocaleFromLanguageCode = function(language = null) {
	if (language == null) {
		return getLocaleFromLanguageCode(config.language);
	}

	switch (language) {
		case 'de':
			return 'de-DE';
		case 'da':
			return 'da-DK';
		case 'it':
			return 'it-IT';
		case 'is':
			return 'is-IS';
		case 'fr':
			return 'fr-FR';
		case 'es':
			return 'es-ES';
		case 'tr':
			return 'tr-TR';
		case 'ru':
			return 'ru-RU';
		case 'ro':
			return 'ro-RO';
		case 'en':
			return 'en-GB';
		case 'ja':
			return 'ja-JP';
		case 'cy':
			return 'cy-GB';
		case 'pt':
			return 'pt-PT';
		case 'nl':
			return 'nl-NL';
		case 'nb':
			return 'nb-NO';
		case 'sv':
			return 'sv-SE';
	}
};

/**
 * Get the local URI of a remote object by downloading it
 * @param {String} uri
 */
global.getLocalObjectFromURI = function(uri) {
	return new Promise((resolve, reject) => {
		if (/^https?\:\/\//.test(uri)) {
			let extension = uri.split('.').pop() || 'unknown';
			const local_file = __cachedir + '/' + md5(uri) + '.' + extension;
			if (fs.existsSync(local_file)) {
				return resolve(local_file);
			}

			return request(uri)
				.pipe(fs.createWriteStream(local_file))
				.on('close', () => {
					if (!fs.existsSync(local_file)) return reject();
					resolve(local_file);
				});
		}

		return resolve(uri);
	});
};

global.extractWithPattern = function extractWithPattern(input, pattern) {
	if (input == null) return null;
	if (pattern == '') return input;

	const p = pattern.split('.');
	let _p = p.shift();

	// Array search
	if (_p === '[]') {
		_p = p.shift();
		for (let _input of input) {
			if (_input[_p] != null) {
				const found = extractWithPattern(_input[_p], p.join('.'));
				if (found) return found;
			}
		}
		return null;
	}

	if (p.length === 0) {
		return input[_p];
	}

	return extractWithPattern(input[_p], p.join('.'));
};

global.timeout = function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};

function jsonToStructProto(json) {
	const fields = {};
	for (const k in json) {
		fields[k] = jsonValueToProto(json[k]);
	}

	return { fields };
}

const JSON_SIMPLE_TYPE_TO_PROTO_KIND_MAP = {
	[typeof 0]: 'numberValue',
	[typeof '']: 'stringValue',
	[typeof false]: 'boolValue'
};

const JSON_SIMPLE_VALUE_KINDS = new Set([
	'numberValue',
	'stringValue',
	'boolValue'
]);

function jsonValueToProto(value) {
	const valueProto = {};

	if (value === null) {
		valueProto.kind = 'nullValue';
		valueProto.nullValue = 'NULL_VALUE';
	} else if (value instanceof Array) {
		valueProto.kind = 'listValue';
		valueProto.listValue = { values: value.map(jsonValueToProto) };
	} else if (typeof value === 'object') {
		valueProto.kind = 'structValue';
		valueProto.structValue = jsonToStructProto(value);
	} else if (typeof value in JSON_SIMPLE_TYPE_TO_PROTO_KIND_MAP) {
		const kind = JSON_SIMPLE_TYPE_TO_PROTO_KIND_MAP[typeof value];
		valueProto.kind = kind;
		valueProto[kind] = value;
	} else {
		console.warn('Unsupported value type ', typeof value);
	}
	return valueProto;
}

function structProtoToJson(proto) {
	if (!proto || !proto.fields) {
		return {};
	}
	const json = {};
	for (const k in proto.fields) {
		json[k] = valueProtoToJson(proto.fields[k]);
	}
	return json;
}

function valueProtoToJson(proto) {
	if (!proto || !proto.kind) {
		return null;
	}

	if (JSON_SIMPLE_VALUE_KINDS.has(proto.kind)) {
		return proto[proto.kind];
	} else if (proto.kind === 'nullValue') {
		return null;
	} else if (proto.kind === 'listValue') {
		if (!proto.listValue || !proto.listValue.values) {
			console.warn('Invalid JSON list value proto: ', JSON.stringify(proto));
		}
		return proto.listValue.values.map(valueProtoToJson);
	} else if (proto.kind === 'structValue') {
		return structProtoToJson(proto.structValue);
	} else {
		console.warn('Unsupported JSON value proto kind: ', proto.kind);
		return null;
	}
}

global.structProtoToJson = structProtoToJson;
