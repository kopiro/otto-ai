const TAG = 'Scheduler/GoodMorning';

const moment = apprequire('moment');

exports.run = function({ session }) {
	const now = moment();

	IOManager.output({ 
		speech: 'Ehi, hai visto che ore sono?! Secondo me dovremmo andare a dormire'
	}, session);
};