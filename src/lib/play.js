const TAG = 'Play';

const { spawn } = require('child_process');
const path = require('path');

const _config = config.play;

const processes = {};

/**
 * Kill all playing processes
 */
exports.kill = function () {
  for (const pid of Object.keys(processes)) {
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
exports.playURI = async (uri, addArgs = [], program = 'play') => new Promise(async (resolve, reject) => {
  const localUri = await getLocalObjectFromURI(uri);

  const proc = spawn(program, [localUri].concat(addArgs));
  processes[proc.pid] = true;

  let stderr = '';
  proc.stderr.on('data', (buf) => {
    stderr += buf;
  });

  proc.on('close', (err) => {
    delete processes[proc.pid];
    if (err) {
      return reject(stderr);
    }

    resolve(localUri);
  });
});

/**
 * Play an item using voice effects
 * @param {String} file
 */
exports.playVoice = async function (uri) {
  return exports.playURI(uri, _config.addArgs);
};

/**
 * Play an item using voice effects to a temporary file
 * @param {String} uri
 */
exports.playVoiceToFile = async function (uri, file) {
  await exports.playURI(uri, [file].concat(_config.addArgs), 'sox');
  return file;
};

/**
 * Play an item using voice effects to a temporary file
 * @param {String} uri
 */
exports.playVoiceToTempFile = function (uri) {
  const file = path.join(__tmpdir, `${uuid()}.mp3`);
  return exports.playVoiceToFile(uri, file);
};
