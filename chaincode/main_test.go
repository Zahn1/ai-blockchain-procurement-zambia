package main

import (
	"testing"

	"github.com/Zahn1/ai-blockchain-procurement-zambia/chaincode/contracts"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	"github.com/stretchr/testify/require"
)

// The contract API checks every exported function's signature and types when the chaincode is created.
// Running that check here catches problems before deployment to a peer.
func TestChaincodeMetadataIsValid(t *testing.T) {
	cc, err := contractapi.NewChaincode(
		&contracts.TenderContract{}, &contracts.BidContract{}, &contracts.AwardContract{},
		&contracts.MilestoneContract{}, &contracts.AlertContract{},
	)
	require.NoError(t, err)
	require.NotNil(t, cc)
}
