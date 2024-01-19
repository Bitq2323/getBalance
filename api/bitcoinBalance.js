const ElectrumClient = require('electrum-client');
const getScriptHash = require('./getScript'); // Make sure this path correctly points to your getScript.js file
const bitcoin = require('bitcoinjs-lib');

function isValidAddress(address) {
    try {
        bitcoin.address.toOutputScript(address);
        return true;
    } catch (e) {
        return false;
    }
}

async function getAddressDetails(address, electrumClient) {
    try {
        const scriptHash = getScriptHash(address);
        if (!scriptHash) {
            throw new Error(`Failed to get script hash for address ${address}`);
        }

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

        const totalTransactions = history.length;

        return {
            address,
            balanceBTC,
            confirmedTransactions,
            unconfirmedTransactions,
            totalTransactions
        };
    } catch (e) {
        console.error(`Error getting details for address ${address}: ${e.message}`);
        throw e;
    }
}

async function getBalanceForAddress(address, electrumClient) {
    try {
        const scriptHash = getScriptHash(address);
        if (!scriptHash) {
            throw new Error(`Failed to get script hash for address ${address}`);
        }

        const utxos = await electrumClient.blockchainScripthash_listunspent(scriptHash);
        const balance = utxos.reduce((total, utxo) => total + utxo.value, 0);
        return balance / 1e8; // Convert to BTC
    } catch (e) {
        console.error(`Error getting balance for address ${address}: ${e.message}`);
        throw e;
    }
}

module.exports = async (req, res) => {
    try {
        if(req.method !== 'POST') {
            res.status(405).send({ error: 'Method Not Allowed' });
            return;
        }

        let inputAddresses = req.body.addresses || "";
        let isMulti = req.body.multi || false;
        let specifiedServer = req.body.server;

        if (!specifiedServer) {
            res.status(400).send('Electrum server is required.');
            return;
        }

        let addressesToCheck = inputAddresses.split(',').map(address => address.trim());
        addressesToCheck = [...new Set(addressesToCheck)].filter(address => address !== '');

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
        let client = null;

        for (const address of addressesToCheck) {
            if (!isValidAddress(address)) {
                throw new Error(`Invalid address: ${address}`);
            }
        }

        let balanceDetails;
        for (const server of serversToTry) {
            try {
                const [hostname, port] = server.split(':');
                client = new ElectrumClient(port, hostname, 'tls');
                await client.connect();

                if (!isMulti && addressesToCheck.length === 1) {
                    balanceDetails = await getAddressDetails(addressesToCheck[0], client);
                } else {
                    const balances = await Promise.all(
                        addressesToCheck.map(address => getBalanceForAddress(address, client))
                    );
                    const totalBalance = balances.reduce((acc, balance) => acc + balance, 0);
                    balanceDetails = { totalBalance: totalBalance.toFixed(8) };
                }
                client.close();
                break;
            } catch (serverError) {
                console.warn(`Server ${server} failed: ${serverError.message}`);
                if (client) client.close();
            }
        }

        if (balanceDetails) {
            res.status(200).send(JSON.stringify(balanceDetails, null, 3));
        } else {
            throw new Error("All servers failed to respond.");
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send({ error: 'Internal Server Error', details: error.message });
    } finally {
        if (client) client.close();
    }
};