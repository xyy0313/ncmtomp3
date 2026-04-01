const fs = require('fs');      // Node.js 内置模块，用于文件系统操作（读写文件）
const aes = require('aes-js'); // 第三方库，提供 AES 加密/解密算法实现

const sourcePath = './ncm';  // 指定存放待转换 .ncm 文件的源文件夹
const targetPath = './mp3';  // 指定存放转换后 .mp3 文件的目标文件夹

// 异步读取 sourcePath 文件夹下的所有文件名，结果存入 files 数组
fs.readdir(sourcePath, function (_, files) {
    // 遍历每个文件
    files.forEach(v => {
        // 读取当前文件的完整二进制数据 (Buffer)
        const file = fs.readFileSync(sourcePath + '/' + v);

        // 设置一个全局偏移量，跳过 NCM 文件的固定前缀 (前 10 字节)
        let globalOffset = 10;

        // 从第 10 字节开始，读取一个 32 位小端整数，即密钥数据的长度
        const keyLength = file.readUInt32LE(10);

        // 偏移量前进 4 字节
        globalOffset += 4;

        // 创建一个指定长度的缓冲区来存放原始密钥数据
        const keyData = Buffer.alloc(keyLength);

        // 从文件中复制密钥数据到 keyData 缓冲
        file.copy(keyData, 0, globalOffset, globalOffset + keyLength);

        // 更新偏移量
        globalOffset += keyLength;

        // 对密钥数据进行简单的字节异或解码 (XOR 0x64)
        for (let i = 0; i < keyLength; i++) {
            keyData[i] ^= 0x64;
        }

        // 定义一个固定的 AES 加密模式下的核心密钥 (Core Key)
        const coreKey = new Uint8Array([0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F, 0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78, 0x57]);

        // 初始化 AES ECB 模式解密器
        const aesEcb = new aes.ModeOfOperation.ecb(coreKey);

        let decodedKeyData;

        try {
            // 使用 AES ECB 模式解密经过 XOR 处理的密钥数据
            decodedKeyData = aes.padding.pkcs7.strip(
                aesEcb.decrypt(keyData)
            );
        } catch (error) {
            console.error(error);
            return;
        }

        // 提取最终用于 RC4 解密的密钥 (跳过前 17 字节的头部信息)
        const trimKeyData = decodedKeyData.slice(17);

        // 解密歌曲元数据 (Metadata)
        // 读取并解密元数据长度和元数据本身
        const metaLength = file.readUInt32LE(globalOffset);
        globalOffset += 4;
        const metaData = Buffer.alloc(metaLength);
        file.copy(metaData, 0, globalOffset, globalOffset + metaLength);
        globalOffset += metaLength;
        for (let i = 0; i < metaLength; i++) {
            metaData[i] ^= 0x63;
        }

        // 跳过一些未知数据 (可能是 CRC 校验或其他元数据)
        file.readUInt32LE(globalOffset);
        globalOffset += 4;
        globalOffset += 5;

        // 读取并提取专辑封面图片数据
        const imageLength = file.readUInt32LE(globalOffset);
        globalOffset += 4;
        const imageBuffer = Buffer.alloc(imageLength);
        file.copy(imageBuffer, 0, globalOffset, globalOffset + imageLength);
        globalOffset += imageLength;
         // 将提取的图片数据写入一个新的 .jpg 文件，文件名与原 .ncm 文件同名
        fs.writeFileSync(targetPath + '/' + v.replace(/.ncm/, '') + '.jpg', imageBuffer);

        // 解密音频数据 (使用 RC4-like 算法)
        function buildKeyBox(key) {
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

        // 使用之前提取的密钥生成解密所需的 "盒子"
        const box = buildKeyBox(trimKeyData);

         // 循环读取并解密音频数据块
        let n = 0x8000;
        let fmusic = [];
        while (n > 1) {
            const buffer = Buffer.alloc(n);
            n = file.copy(buffer, 0, globalOffset, globalOffset + n);
            globalOffset += n;

             // 使用自定义的 RC4-like 算法解密当前数据块
            for (let i = 0; i < n; i++) {
                let j = (i + 1) & 0xff;
                buffer[i] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
            }

            fmusic.push(buffer);
        }
        // 将所有解密后的音频数据块合并成一个完整的音频文件，并写入目标文件夹
        fs.writeFileSync(targetPath + '/' + v.replace(/.ncm/, '.mp3'), Buffer.concat(fmusic));
    })
})
