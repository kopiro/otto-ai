require('./boot');

if (config.cron) {
	require(__basedir + '/cron');
}

if (config.server) {
	require(__basedir + '/server');
}

let outPhoto = (data, photo, io) => {
	if (photo.isFace) return outFace(data, photo, io);

	return new Promise((resolve, reject) => {
		require(__basedir + '/support/visionrecognizer').detectLabels(photo.stream || photo.localFile, (err, labels) => {
			if (err) return reject(err);

			if (_.intersection(public_config.faceRecognitionLabels, labels).length > 0) {
				outFace(data, photo, io)
				.then(resolve)
				.catch((err) => { 
					outVision(data, labels)
					.then(resolve)
					.catch(reject); 
				});
			} else {
				outVision(data, labels, io)
				.then(resolve)
				.catch(reject); 
			}
		});
	});
};

let outFace = (data, photo, io) => {
	const FaceRecognizer = require(__basedir + '/support/facerecognizer');

	return new Promise((resolve, reject) => {
		FaceRecognizer.detect(photo.stream || photo.remoteFile, (err, resp) => {
			if (resp.length === 0) return reject(err);

			FaceRecognizer.identify([ resp[0].faceId ], (err, resp) => {
				if (resp.length === 0 || resp[0] == null || resp[0].candidates.length === 0) return reject(err);

				let person_id = resp[0].candidates[0].personId;

				Memory.Contact.where({ person_id: person_id })
				.fetch({ required: true })
				.then((contact) => {
					const name = contact.get('first_name');
					const responses = [
					`Hey, ciao ${name}!`,
					`Ma... è ${name}`,
					`Da quanto tempo ${name}!, come stai??`
					];

					resolve({ text: responses.getRandom() });
				})
				.catch(reject);

			}); 
		}); 
	});
};

let outVision = (data, labels, io) => {
	return new Promise((resolve, reject) => {
		require(__basedir + '/support/translator').translate(labels[0] + ', ' + labels[1], 'it', (err, translation) => {
			if (err) return reject(err);

			let responses = [
			`Uhm... mi sembra di capire che stiamo parlando di ${translation}`,
			`Questo sembra ${translation}`,
			`Aspetta... lo so... è ${translation}`
			];

			resolve({ text: responses.getRandom() });
		});
	});
};

let IOs = [];
config.ioDrivers.forEach((driver) => {
	IOs.push(require(__basedir + '/io/' + driver));
});

function errorResponse(e) {
	let io = this;
	e.error = e.error || {};
	io.output(e)
	.then(io.startInput)
	.catch(io.startInput);
}

function onIoResponse({ error, data, params }) {
	let io = this;

	try {

		if (error) {
			throw error;
		}

		let promise = null;

		if (params.action) {
			promise = Actions[params.action]()(params.data, io);
		} else if (params.text) {
			promise = APIAI.textRequest(data, params.text, io);
		} else if (params.photo) {
			promise = outPhoto(data, params.photo, io);
		} else if (params.answer) {
			promise = new Promise((resolve, reject) => {
				resolve({ text: params.answer });
			});
		} else {
			throw {
				unsupported: true,
				message: 'This input type is not supported yet. Supported: text, photo, answer' 
			};
		}

		if (promise != null) {
			promise
			.then((resp) => { 
				io.output({
					data: data,
					params: resp
				})
				.then(io.startInput)
				.catch(io.startInput); 
			})
			.catch((promise_error) => {

				console.error(promise_error);

				// Check if this query could be solved using the Learning Memory Module. 
				new Memory.Learning()
				.query((qb) => {
					qb.select(Memory.__knex.raw(`*, MATCH (input) AGAINST ("${params.text}" IN NATURAL LANGUAGE MODE) AS score`));
					qb.having('score', '>', '0');
					qb.orderBy(Memory.__knex.raw('RAND()'));
				})
				.fetch({ require: true })
				.then((learning) => {

					console.debug('Found a learning reply');
					
					if (learning.get('reply')) {
						onIoResponse.call(io, {
							data: data,
							params: {
								answer: learning.get('reply')
							}
						});
					} else if (learning.get('action')) {
						// To implement parameters
						onIoResponse.call(io, {
							data: data,
							params: {
								action: learning.get('action')
							}
						});
					}
				})
				.catch(() => {
					errorResponse.call(io, {
						data: data,
						error: promise_error
					});
				});
			});
		}

	} catch (ex) {
		errorResponse.call(io, {
			data: data,
			error: ex
		});
	}
}

IOs.forEach((io) => {
	io.emitter.on('input', onIoResponse.bind(io));
	io.startInput();
});
