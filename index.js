const fs = require('fs');
const aes = require('aes-js');
const sourcePath = './ncm';
const targetPath = './mp3';

console.time('1');
fs.readdir(sourcePath, function (_, files) {
    files.forEach(v => {
        const file = fs.readFileSync(sourcePath + '/' + v);
        let globalOffset = 10;

        const keyLength = file.readUInt32LE(10);
        globalOffset += 4;

        const keyData = Buffer.alloc(keyLength);

        file.copy(keyData, 0, globalOffset, globalOffset + keyLength);
        globalOffset += keyLength;

        for (let i = 0; i < keyLength; i++) {
            keyData[i] ^= 0x64;
        }

        const coreKey = new Uint8Array([0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F, 0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78, 0x57]);

        const aesEcb = new aes.ModeOfOperation.ecb(coreKey);

        let decodedKeyData;

        try {
			decodedKeyData = aes.padding.pkcs7.strip(
				aesEcb.decrypt(keyData)
			);
		} catch (error) {
			console.error(error);
            return;
		}

        const trimKeyData = decodedKeyData.slice(17);

        const metaLength = file.readUInt32LE(globalOffset);
        globalOffset += 4;
        const metaData = Buffer.alloc(metaLength);
        file.copy(metaData, 0, globalOffset, globalOffset + metaLength);
        globalOffset += metaLength;
        for (let i = 0; i < metaLength; i++) {
            metaData[i] ^= 0x63;
        }

        file.readUInt32LE(globalOffset);
        globalOffset += 4;
        globalOffset += 5;
        const imageLength = file.readUInt32LE(globalOffset);
        globalOffset += 4;
        const imageBuffer = Buffer.alloc(imageLength);
        file.copy(imageBuffer, 0, globalOffset, globalOffset + imageLength);
        globalOffset += imageLength;
        fs.writeFileSync(targetPath + '/' + v.replace(/.ncm/, '') + '.jpg', imageBuffer);

        function buildKeyBox (key) {
            const keyLength = key.length;
            const box = Buffer.alloc(256);

            for (let i = 0; i < 256; i++) {
                box[i] = i;
            }

            let swap = 0;
            let c = 0;
            let lastByte = 0;
            let keyOffset = 0;

            for (let i = 0; i < 256; ++i) {
                swap = box[i];
                c = ((swap + lastByte + key[keyOffset++]) & 0xff);
                if (keyOffset >= keyLength) {
                    keyOffset = 0;
                }
                box[i] = box[c];
                box[c] = swap;
                lastByte = c;
            }

            return box;
        }

        const box = buildKeyBox(trimKeyData);

        let n = 0x8000;
        let fmusic = [];
        while (n > 1) {
            const buffer = Buffer.alloc(n);
            n = file.copy(buffer, 0, globalOffset, globalOffset + n);
            globalOffset += n;

            for (let i = 0; i < n; i++) {
                let j = (i + 1) & 0xff;
                buffer[i] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
            }

            fmusic.push(buffer);
        }
        fs.writeFileSync(targetPath + '/' + v.replace(/.ncm/, '.mp3'), Buffer.concat(fmusic));
    })
})
