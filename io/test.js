const TAG = 'IO.Test';

const EventEmitter = require('events').EventEmitter;
exports.emitter = new EventEmitter();

exports.capabilities = { 
	userCanViewUrls: true
};

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let strings = fs.readFileSync(__basedir + '/in.txt').toString().split("\n");

exports.startInput = function() {
	console.info(TAG, 'start');

	let data = { time: Date.now() };
	let msg = strings.shift();

	if (_.isEmpty(msg)) {
		rl.question('> ', (answer) => {
			console.user(TAG, 'input', answer);
			exports.emitter.emit('input', {
				data: data,
				params: {
					text: answer
				}
			});
		});
	} else {
		console.user(TAG, 'input', msg);
		exports.emitter.emit('input', {
			data: data,
			params: {
				text: msg
			}
		});
	}
};

exports.output = function(e) {
	if (null == config.testDriverOut) {
		console.ai(TAG, 'output', e);
		return Promise.resolve();
	}

	return require(__basedir + '/io/' + config.testDriverOut).output(e);
};