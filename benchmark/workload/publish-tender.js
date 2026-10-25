'use strict';
// Writes: publishes a tender straight to the ledger (endorsed by ZPPA and OAG, ordered and committed).
// The tenders exist only on the ledger, so they never appear in the portal, search or reports.
const crypto = require('crypto');
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class PublishTender extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.run = `${Date.now().toString(36).toUpperCase()}-R${roundIndex}-W${workerIndex}`;
    this.count = 0;
    this.closing = new Date(Date.now() + 30 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  async submitTransaction() {
    this.count += 1;
    await this.sutAdapter.sendRequests({
      contractId: 'procurement',
      contractFunction: 'TenderContract:PublishTender',
      contractArguments: [`CALIPER/${this.run}/${this.count}`, '1000000', this.closing, JSON.stringify([crypto.randomBytes(32).toString('hex')]), '2'],
      invokerIdentity: 'officer1',
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new PublishTender();
