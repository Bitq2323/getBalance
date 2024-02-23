const ElectrumClient = require('electrum-client');
const bitcoin = require('bitcoinjs-lib');

function isValidAddress(address) {
    try {
        bitcoin.address.toOutputScript(address);
        return true;
    } catch (e) {
        return false;
    }
}

function getScriptHash(address) {
    let output;

    try {
        if (address.startsWith('1')) {
            const { hash } = bitcoin.address.fromBase58Check(address);
            output = bitcoin.script.compile([
                bitcoin.opcodes.OP_DUP,
                bitcoin.opcodes.OP_HASH160,
                hash,
                bitcoin.opcodes.OP_EQUALVERIFY,
                bitcoin.opcodes.OP_CHECKSIG
            ]);
        } else if (address.startsWith('3')) {
            const payment = bitcoin.payments.p2sh({
                address: address,
                network: bitcoin.networks.bitcoin,
            });
            output = payment.output;
        } else if (address.startsWith('bc1')) {
            const bech32Decoded = bitcoin.address.fromBech32(address);
            if (bech32Decoded.data.length === 20) {
                output = bitcoin.payments.p2wpkh({ hash: bech32Decoded.data }).output;
            } else if (bech32Decoded.data.length === 32) {
                output = bitcoin.payments.p2wsh({ hash: bech32Decoded.data }).output;
            }
        }
    } catch (err) {
        console.log(`Failed to get script hash for address ${address}: ${err.message}`);
        return null;
    }

    if (!output) {
        console.log(`Unsupported address type: ${address}`);
        return null;
    }

    const scriptHash = bitcoin.crypto.sha256(output);
    return Buffer.from(scriptHash).reverse().toString('hex');
}


async function getAddressDetails(address, electrumClient) {
    try {
        const scriptHash = getScriptHash(address);
        const utxos = await electrumClient.blockchainScripthash_listunspent(scriptHash);
        const balance = utxos.reduce((total, utxo) => total + utxo.value, 0);
        const balanceBTC = balance / 1e8;

        const history = await electrumClient.blockchainScripthash_getHistory(scriptHash);
        let confirmedTransactions = 0;
        let unconfirmedTransactions = 0;
        history.forEach(tx => {
            if (tx.height > 0) {
                confirmedTransactions++;
            } else {
                unconfirmedTransactions++;
            }
        });

        return {
            address,
            balanceBTC,
            confirmedTransactions,
            unconfirmedTransactions,
            totalTransactions: history.length
        };
    } catch (e) {
        console.error(`Error getting details for address ${address}: ${e.message}`);
        throw e;
    }
}

async function getBalanceForAddress(address, electrumClient) {
    try {
        const scriptHash = getScriptHash(address);
        const utxos = await electrumClient.blockchainScripthash_listunspent(scriptHash);
        const balance = utxos.reduce((total, utxo) => total + utxo.value, 0);
        return balance / 1e8; // Convert to BTC
    } catch (e) {
        console.error(`Error getting balance for address ${address}: ${e.message}`);
        throw e;
    }
}

// Assuming previous functions (isValidAddress, getScriptHash, getAddressDetails) remain unchanged

module.exports = async (req, res) => {
    let client = null;

    try {
        if (req.method !== 'POST') {
            res.status(405).send({ error: 'Method Not Allowed' });
            return;
        }

        const inputAddresses = req.body.addresses || "";
        const isMulti = req.body.multi || false;
        const specifiedServer = req.body.server;
        if (!specifiedServer) {
            res.status(400).send('Electrum server is required.');
            return;
        }

        let addressesToCheck = inputAddresses.split(',').map(address => address.trim());
        addressesToCheck = [...new Set(addressesToCheck)].filter(isValidAddress);
    // List of fallback Electrum servers
    const fallbackServers = [
        'bolt.schulzemic.net:50002',
        'de.poiuty.com:50002',
        'electrum.kcicom.net:50002',
        'api.ordimint.com:50002',
        'electrum.blockstream.info:50002',
        'bitcoin.aranguren.org:50002',
        'electrum.jochen-hoenicke.de:50006',
        'vmd104012.contaboserver.net:50002',
        'bitcoin.grey.pw:50002',
        'btc.aftrek.org:50002'
    ];

    
        let serversToTry = [specifiedServer, ...fallbackServers];

        for (const server of serversToTry) {
            try {
                const [hostname, port] = server.split(':');
                client = new ElectrumClient(port, hostname, 'tls');
                await client.connect();

                if (!isMulti) {
                    const details = await getAddressDetails(addressesToCheck[0], client);
                    // Ensure balanceBTC is a double
                    details.balanceBTC = parseFloat(details.balanceBTC);
                    res.status(200).send(details);
                    return;
                } else {
                    // Handling multiple addresses
                    let addressesDetails = [];
                    let totalBalance = 0;
                    let totalTransactions = 0;
                    let totalConfirmedTransactions = 0;
                    let totalUnconfirmedTransactions = 0;

                    let promises = addressesToCheck.map(address => getAddressDetails(address, client));
                    let results = await Promise.all(promises);

                    results.forEach(result => {
                        // Ensure balanceBTC is a double for each result
                        result.balanceBTC = parseFloat(result.balanceBTC);
                        addressesDetails.push(result);
                        totalBalance += result.balanceBTC;
                        totalTransactions += result.totalTransactions;
                        totalConfirmedTransactions += result.confirmedTransactions;
                        totalUnconfirmedTransactions += result.unconfirmedTransactions;
                    });

                    let response = {
                        addressesDetails,
                        totalBalance: totalBalance.toFixed(8), // Keep totalBalance as a String
                        totalTransactions,
                        totalConfirmedTransactions,
                        totalUnconfirmedTransactions,
                        totalAddressesFetched: addressesDetails.length
                    };
                    res.status(200).send(response);
                    return;
                }
            } catch (serverError) {
                console.warn(`Server ${server} failed: ${serverError.message}`);
            } finally {
                if (client) {
                    client.close();
                }
            }
        }

        throw new Error("All servers failed to respond.");
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send({ error: 'Internal Server Error', details: error.message });
    }
};
