// Command chaincode starts the procurement chaincode with all its contracts.
package main

import (
	"log"

	"github.com/Zahn1/ai-blockchain-procurement-zambia/chaincode/contracts"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func main() {
	cc, err := contractapi.NewChaincode(&contracts.TenderContract{}, &contracts.BidContract{})
	if err != nil {
		log.Panicf("creating procurement chaincode: %v", err)
	}
	cc.Info.Title = "Zambia transparent procurement"
	cc.Info.Version = "0.1.0"
	if err := cc.Start(); err != nil {
		log.Panicf("starting procurement chaincode: %v", err)
	}
}
