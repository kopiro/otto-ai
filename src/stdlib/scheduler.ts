import Moment from "../lib/moment";
import * as Data from "../data";
import config from "../config";
import { Scheduler as SchedulerModel } from "../types";

const TAG = "Scheduler";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

export type SchedulerProgramName = "input";

export abstract class SchedulerProgramClass {
  job: SchedulerModel;
  constructor(job: SchedulerModel) {
    this.job = job;
  }
  abstract run();
}

export class Scheduler {
  started = false;

  async getJobs(conditions = []): Promise<SchedulerModel[]> {
    const time = Moment().seconds(0); // Get current time but reset seconds to zero
    const query = [
      { yearly: time.format("DDD HH:mm:ss") },
      { monthly: time.format("D HH:mm:ss") },
      { weekly: time.format("d HH:mm:ss") },
      { daily: time.format("HH:mm:ss") },
      { hourly: time.format("mm:ss") },
      { everyHalfHour: +time.format("m") % 30 === 0 },
      { everyQuartelyHour: +time.format("m") % 15 === 0 },
      { everyFiveMinutes: +time.format("m") % 5 === 0 },
      { minutely: time.format("ss") },
      { onDate: time.format(FORMAT) },
      { onTick: true },
      ...conditions,
    ];
    const jobs = await Data.Scheduler.find({
      managerUid: config().uid,
      $or: query,
    });
    return jobs;
  }

  async getProgram(job: SchedulerModel): Promise<SchedulerProgramClass> {
    switch (job.programName) {
      case "input":
        return new (await import("../scheduler/input")).default(job);
      case "camera":
        return new (await import("../scheduler/camera")).default(job);
      case "countdown":
        return new (await import("../scheduler/countdown")).default(job);
    }
  }

  async runJob(job: SchedulerModel) {
    console.log(TAG, Date.now(), "running job", {
      programName: job.programName,
      programArgs: job.programArgs,
      "session.id": job.session.id,
    });

    try {
      const program = await this.getProgram(job);
      if (!program) throw new Error(`Program <${job.programName}> not found`);
      const result = await program.run();
      console.debug(TAG, "processed", result);
      return result;
    } catch (err) {
      console.error(TAG, "error", err);
    }
  }

  async tick(conditions = []) {
    const jobs = await this.getJobs(conditions);
    jobs.forEach(this.runJob.bind(this));
  }

  async start() {
    if (this.started) {
      console.warn(TAG, "attempted to start an already started instance");
      return;
    }

    this.started = true;

    console.info(TAG, `polling started`);

    this.tick([{ onBoot: true }]);
    setInterval(this.tick.bind(this), 60 * 1000);
  }
}

export default new Scheduler();
