/** Only the public shape needed by isolated tests, not a Host transaction simulator. */
export class BasicCompactionEngine {
 constructor(ctx, config = {}) {
  this.ctx = ctx
  this.config = { thresholdRatio: 0.8, headroomTokens: 65536, retainRatio: 0.2, summarizationProvider: '', summarizationModel: '', maxTokens: 65536, auto: true, ...config }
 }
 async summarize() { return { summary: [{type:'text',text:'official summary'}] } }
 async compactIfNeeded() { return null }
 async compactRegion() { return null }
}
export default BasicCompactionEngine
