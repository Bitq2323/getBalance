const bitcoinjs = require('bitcoinjs-lib');

function getScriptHash(address) {
    let output;

    try {
        if (address.startsWith('1')) {
            const { hash } = bitcoinjs.address.fromBase58Check(address);
            // Construct the output script manually for P2PKH addresses
            output = bitcoinjs.script.compile([
                bitcoinjs.opcodes.OP_DUP,
                bitcoinjs.opcodes.OP_HASH160,
                hash,
                bitcoinjs.opcodes.OP_EQUALVERIFY,
                bitcoinjs.opcodes.OP_CHECKSIG
            ]);
        } else if (address.startsWith('3')) {
            const payment = bitcoinjs.payments.p2sh({
                address: address,
                network: bitcoinjs.networks.bitcoin,
            });
            output = payment.output;
        } else if (address.startsWith('bc1')) {
            const bech32Decoded = bitcoinjs.address.fromBech32(address);
            if (bech32Decoded.data.length === 20) {
                output = bitcoinjs.payments.p2wpkh({ hash: bech32Decoded.data }).output;
            } else if (bech32Decoded.data.length === 32) {
                output = bitcoinjs.payments.p2wsh({ hash: bech32Decoded.data }).output;
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

    const scriptHash = bitcoinjs.crypto.sha256(output);
    return Buffer.from(scriptHash).reverse().toString('hex');
}

module.exports = getScriptHash;