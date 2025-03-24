
class SimpleBlockingRateLimiter {
    constructor({
        batchInterval,
        batchSize,
        postInterval,
        postIntervalEbb,
        startTime,
        endTime
    }) {
        // Convert seconds to milliseconds
        this.batchInterval = batchInterval * 1000;
        this.batchSize = batchSize;
        this.postInterval = postInterval * 1000;
        this.postIntervalEbb = postIntervalEbb * 1000;
        this.startTime = startTime;
        this.endTime = endTime;
        
        this.currentBatchCount = 0;
        this.lastBatchStartTime = 0;
        this.lastExecutionTime = 0;
    }

    //Sleeper function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    isWithinTimeWindow() {
        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        
        const [startHours, startMinutes] = this.startTime.split(':').map(Number);
        const [endHours, endMinutes] = this.endTime.split(':').map(Number);
        
        const startMinutesTotal = startHours * 60 + startMinutes;
        const endMinutesTotal = endHours * 60 + endMinutes;
        
        // Handle overnight windows
        if (startMinutesTotal > endMinutesTotal) {
        return current >= startMinutesTotal || current <= endMinutesTotal;
        }
        
        return current >= startMinutesTotal && current <= endMinutesTotal;
    }

    getTimeUntilWindowStart() {
        const now = new Date();
        const [startHours, startMinutes] = this.startTime.split(':').map(Number);
        
        let startTime = new Date(now);
        startTime.setHours(startHours, startMinutes, 0, 0);
        
        // If start time is in the past, add a day
        if (startTime <= now) {
        startTime.setDate(startTime.getDate() + 1);
        }
        
        return startTime - now;
    }

    getRandomizedPostInterval() {
        const min = Math.max(0, this.postInterval - this.postIntervalEbb);
        const max = this.postInterval + this.postIntervalEbb;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    //function to call between posts to block
    async execute() {
        const now = Date.now();
        
        // Check if new batch to be started
        if (this.currentBatchCount === 0 || this.currentBatchCount >= this.batchSize) {
        
        if (this.lastBatchStartTime > 0) {
            const timeToWait = this.batchInterval - (now - this.lastBatchStartTime);
            if (timeToWait > 0) {
            console.log(`Waiting for next batch: ${timeToWait}ms`);
            await this.sleep(timeToWait);
            }
        }
        
        // Reset batch
        this.currentBatchCount = 0;
        this.lastBatchStartTime = Date.now();
        } else {
        //wait for post interval
        const interval = this.getRandomizedPostInterval();
        const timeToWait = interval - (now - this.lastExecutionTime);
        
        if (timeToWait > 0) {
            console.log(`Waiting between posts: ${timeToWait}ms`);
            await this.sleep(timeToWait);
        }
        }
        
        //check if we're within the time window
        if (!this.isWithinTimeWindow()) {
        const waitTime = this.getTimeUntilWindowStart();
        console.log(`Outside time window, waiting until next window: ${waitTime}ms`);
        await this.sleep(waitTime);
        }
        
        // Update state
        this.lastExecutionTime = Date.now();
        this.currentBatchCount++;
        
        console.log(`Execution at: ${new Date().toLocaleTimeString()}, batch: ${this.currentBatchCount}`);
    }
}
  
    module.exports = {SimpleBlockingRateLimiter};