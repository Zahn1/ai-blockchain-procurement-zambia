'use strict';
// Reads: queries one tender from a peer (no ordering, nothing written).
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class ReadTender extends WorkloadModuleBase {
  async submitTransaction() {
    await this.sutAdapter.sendRequests({
      contractId: 'procurement',
      contractFunction: 'TenderContract:ReadTender',
      contractArguments: [this.roundArguments.reference],
      invokerIdentity: 'officer1',
      readOnly: true,
    });
  }
}

module.exports.createWorkloadModule = () => new ReadTender();
