import { BarretenbergWasm, createModule } from '../wasm';
import { Blake2s } from '../crypto/blake2s';
import { Pedersen } from '../crypto/pedersen';
import { MerkleTree } from '.';
import levelup from 'levelup';
import memdown from 'memdown';

describe('merkle_tree', () => {
  let barretenberg!: BarretenbergWasm;
  let blake2s!: Blake2s;
  let pedersen!: Pedersen;
  const values: Buffer[] = [];

  beforeAll(async () => {
    barretenberg = new BarretenbergWasm();
    await barretenberg.init(await createModule());
    blake2s = new Blake2s(barretenberg);
    pedersen = new Pedersen(barretenberg);

    for (let i = 0; i < 4; ++i) {
        const v = Buffer.alloc(64, 0);
        v.writeUInt32LE(i, 0);
        values[i] = v;
    }
  });

  it('should have correct root', async () => {
    const db = levelup(memdown());

    const e00 = blake2s.hashToField(values[0]);
    const e01 = blake2s.hashToField(values[1]);
    const e02 = blake2s.hashToField(values[2]);
    const e03 = blake2s.hashToField(values[3]);
    const e10 = pedersen.compress(e00, e01);
    const e11 = pedersen.compress(e02, e03);
    const root = pedersen.compress(e10, e11);

    const tree = new MerkleTree(db, pedersen, blake2s, "test", 2);

    for (let i = 0; i < 4; ++i) {
        await tree.updateElement(i, values[i]);
    }

    for (let i = 0; i < 4; ++i) {
        expect(await tree.getElement(i)).toEqual(values[i]);
    }

    let expected = [
        [ e00, e01 ],
        [ e10, e11 ],
    ];

    expect(await tree.getHashPath(0)).toEqual(expected);
    expect(await tree.getHashPath(1)).toEqual(expected);

    expected = [
        [ e02, e03 ],
        [ e10, e11 ],
    ];

    expect(await tree.getHashPath(2)).toEqual(expected);
    expect(await tree.getHashPath(3)).toEqual(expected);
    expect(tree.getRoot()).toEqual(root);

    // Lifted from memory_store.test.cpp to ensure consistency.
    expect(root).toEqual(Buffer.from('2fa6d2259d22e6992f4824d80cd2ef803c54b83b885d611a6b37c138b119d08b', 'hex'));
  });
});
