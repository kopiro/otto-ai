const TAG = 'Play';

const spawn = require('child_process').spawn;

const _config = config.play;

const processes = {};

exports.kill = function() {
	for (let pid of Object.keys(processes)) {
		process.kill(pid);
		delete processes[pid];
	}
	return exports;
};

/**
 * Play an item
 * @param {String} uri	URI or file
 * @param {Array} addArgs	Eventual voice effects
 */
exports.playURI = async function(uri, addArgs = [], program = 'play') {
	return new Promise(async(resolve, reject) => {
		let localUri = await getLocalObjectFromURI(uri);

		const proc = spawn(program, [localUri].concat(addArgs));
		processes[proc.pid] = true;

		proc.on('close', (err) => {
			delete processes[proc.pid];
			if (err) return reject(err);
			resolve(localUri);
		});
	});
};

/**
 * Play an item using voice effects
 * @param {String} file 
 */
exports.playVoice = async function(uri) {
	return exports.playURI(uri, _config.addArgs);
};

/**
 * Play an item using voice effects to a temporary file
 * @param {String} uri 
 */
exports.playVoiceToTempFile = function(uri) {
	const tempFile = __tmpdir + '/' + uuid() + '.mp3';
	return exports.playURI(uri, [ tempFile ].concat(_config.addArgs), 'sox');
};