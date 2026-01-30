
const bs58 = require('bs58');
const bytes = [98, 238, 61, 252, 130, 77, 105, 67];
const encoded = bs58.encode(Buffer.from(bytes));
console.log(`Bytes: [${bytes}]`);
console.log(`Encoded: ${encoded}`);
console.log(`Expected: Gv8UvX61jE5`);
console.log(`Match? ${encoded === 'Gv8UvX61jE5'}`);
