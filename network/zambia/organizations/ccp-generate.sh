#!/usr/bin/env bash

function one_line_pem {
    echo "`awk 'NF {sub(/\\n/, ""); printf "%s\\\\\\\n",$0;}' $1`"
}

function json_ccp {
    local PP=$(one_line_pem $4)
    local CP=$(one_line_pem $5)
    sed -e "s/\${ORGNAME}/$ORGNAME/g" -e "s/\${ORGLABEL}/$ORGLABEL/g" -e "s/\${MSPID}/$MSPID/g" \
        -e "s/\${P0PORT}/$2/" \
        -e "s/\${CAPORT}/$3/" \
        -e "s#\${PEERPEM}#$PP#" \
        -e "s#\${CAPEM}#$CP#" \
        organizations/ccp-template.json
}

function yaml_ccp {
    local PP=$(one_line_pem $4)
    local CP=$(one_line_pem $5)
    sed -e "s/\${ORGNAME}/$ORGNAME/g" -e "s/\${ORGLABEL}/$ORGLABEL/g" -e "s/\${MSPID}/$MSPID/g" \
        -e "s/\${P0PORT}/$2/" \
        -e "s/\${CAPORT}/$3/" \
        -e "s#\${PEERPEM}#$PP#" \
        -e "s#\${CAPEM}#$CP#" \
        organizations/ccp-template.yaml | sed -e $'s/\\\\n/\\\n          /g'
}

ORG=1 ORGNAME=zppa ORGLABEL=ZPPA MSPID=ZPPAMSP
P0PORT=7051
CAPORT=7054
PEERPEM=organizations/peerOrganizations/zppa.example.com/tlsca/tlsca.zppa.example.com-cert.pem
CAPEM=organizations/peerOrganizations/zppa.example.com/ca/ca.zppa.example.com-cert.pem

echo "$(json_ccp $ORG $P0PORT $CAPORT $PEERPEM $CAPEM)" > organizations/peerOrganizations/zppa.example.com/connection-zppa.json
echo "$(yaml_ccp $ORG $P0PORT $CAPORT $PEERPEM $CAPEM)" > organizations/peerOrganizations/zppa.example.com/connection-zppa.yaml

ORG=2 ORGNAME=oag ORGLABEL=OAG MSPID=OAGMSP
P0PORT=9051
CAPORT=8054
PEERPEM=organizations/peerOrganizations/oag.example.com/tlsca/tlsca.oag.example.com-cert.pem
CAPEM=organizations/peerOrganizations/oag.example.com/ca/ca.oag.example.com-cert.pem

echo "$(json_ccp $ORG $P0PORT $CAPORT $PEERPEM $CAPEM)" > organizations/peerOrganizations/oag.example.com/connection-oag.json
echo "$(yaml_ccp $ORG $P0PORT $CAPORT $PEERPEM $CAPEM)" > organizations/peerOrganizations/oag.example.com/connection-oag.yaml
