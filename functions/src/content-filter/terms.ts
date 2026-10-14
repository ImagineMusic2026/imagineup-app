import type { FilterEntryKeys } from './match';

/**
 * A lista do filtro do que o fã publica (docs/arquitetura-api.md, 30.4), por
 * chaves: o SHA-256 de cada pedaço normalizado e das frases com os pedaços
 * juntos, com a categoria e os tamanhos dos `inHandle`. A lista legível fica
 * fora de todo repositório (`filtro-lista/termos.json`, opção (a') da pergunta
 * 1 do dono), e nenhum termo legível entra aqui.
 *
 * Gerado por `node scripts/content-filter-keys.mjs`, depois do
 * `npm --prefix functions run build`. Não edite à mão: mude a lista legível e
 * gere de novo.
 */

/** A `FILTER_NORMALIZATION_VERSION` do `normalize.ts` com que as chaves foram geradas. */
export const FILTER_NORMALIZATION_VERSION = 2;

export const FILTER_ENTRIES: readonly FilterEntryKeys[] = [
  {
    category: 'profanity',
    forms: [
      ['75f4c0fbd5a2d162181cfe4b8cc0afe08072054b03dfe61d3c7125962e3d3db6'],
      ['a90a3df635e852eabef4bd1786a8a46f22d0af5cd4c6ac7526773119bc237064'],
    ],
    joined: [
      '75f4c0fbd5a2d162181cfe4b8cc0afe08072054b03dfe61d3c7125962e3d3db6',
      'a90a3df635e852eabef4bd1786a8a46f22d0af5cd4c6ac7526773119bc237064',
    ],
  },
  {
    category: 'profanity',
    forms: [
      ['c0f9c42d0879573e1fcf23e080a8e919b33d5d428678c27a1c5695f7fd0c7b81'],
      ['3ddd9f918acb285c792c6d987bbafde46b2a9d87cb477813d68a0ebe654138dc'],
      ['e7eed9c9a8127df5374bc453b7615b9edd4cc57970ebd16887112a1010c1c7e7'],
    ],
    joined: [
      'c0f9c42d0879573e1fcf23e080a8e919b33d5d428678c27a1c5695f7fd0c7b81',
      '3ddd9f918acb285c792c6d987bbafde46b2a9d87cb477813d68a0ebe654138dc',
      'e7eed9c9a8127df5374bc453b7615b9edd4cc57970ebd16887112a1010c1c7e7',
    ],
    handleLengths: [7, 9, 9],
  },
  {
    category: 'profanity',
    forms: [['6f11c33e510b4a7ca618cb83c1bc31a6c92ff112c0eb2e41ee408aafcfbbf2cf']],
    joined: ['6f11c33e510b4a7ca618cb83c1bc31a6c92ff112c0eb2e41ee408aafcfbbf2cf'],
  },
  {
    category: 'profanity',
    forms: [
      ['13841bb17efbc3d1099aca5c0d4ed6b7be04d1635682e64202435c104d54c502'],
      ['386a5a3d5dd51d3542897e5a2cad3422757c8e0d5e25080f53b2e0f7d52a1912'],
      ['7494b38b42ac56bbacd9551dd42a2e98d90dd2d4a8c5ee7cf9e920e393e62ba4'],
    ],
    joined: [
      '13841bb17efbc3d1099aca5c0d4ed6b7be04d1635682e64202435c104d54c502',
      '386a5a3d5dd51d3542897e5a2cad3422757c8e0d5e25080f53b2e0f7d52a1912',
      '7494b38b42ac56bbacd9551dd42a2e98d90dd2d4a8c5ee7cf9e920e393e62ba4',
    ],
  },
  {
    category: 'profanity',
    forms: [
      ['66a65afbf25fc4de9327e7b1d489fe0e6ad113fbba84980c89ad83c4cfaa5b04'],
      ['b3208633abfe25c25a71cfd26ca66c766da5846577893bc4b1a01642116b9e33'],
      ['b4bc01fada145abd062d7630bf33f33a096c2e9b4394d9d874f26e66824cb8b7'],
      ['0c0cf630215f02d5eccfc7d745015925a42251f73cc6635a4df62bf55d6cda99'],
    ],
    joined: [
      '66a65afbf25fc4de9327e7b1d489fe0e6ad113fbba84980c89ad83c4cfaa5b04',
      'b3208633abfe25c25a71cfd26ca66c766da5846577893bc4b1a01642116b9e33',
      'b4bc01fada145abd062d7630bf33f33a096c2e9b4394d9d874f26e66824cb8b7',
      '0c0cf630215f02d5eccfc7d745015925a42251f73cc6635a4df62bf55d6cda99',
    ],
    handleLengths: [5, 8, 6, 7],
  },
  {
    category: 'profanity',
    forms: [
      ['634d28934cddcfa41a7676a2b9c3d994c8ea1586b9afba963f9f3bc5702ac473'],
      ['c8ae3cc51d2d7989ba80a5a534b4a4cada70f48d2143debc8fa9a14c69b4da83'],
      ['915082768f8c32abbe67502a36042537f79034492752aeaae50c60649b26a09a'],
      ['6f6bd21bca801182e3ac368624708b081a27dfe7730c2539df619de88fc1877a'],
      ['148ad9ea8c50703435eb9a40256f1595c2c59c6c59d751c805520ed10c507c06'],
    ],
    joined: [
      '634d28934cddcfa41a7676a2b9c3d994c8ea1586b9afba963f9f3bc5702ac473',
      'c8ae3cc51d2d7989ba80a5a534b4a4cada70f48d2143debc8fa9a14c69b4da83',
      '915082768f8c32abbe67502a36042537f79034492752aeaae50c60649b26a09a',
      '6f6bd21bca801182e3ac368624708b081a27dfe7730c2539df619de88fc1877a',
      '148ad9ea8c50703435eb9a40256f1595c2c59c6c59d751c805520ed10c507c06',
    ],
    handleLengths: [5, 8, 6, 7, 7],
  },
  {
    category: 'profanity',
    forms: [
      ['bbfdd53c04dbdd6b85de296e7492f53bb0ff96054235d794290cd562fb7fa8c4'],
      ['5345ef309b1bc976441ce4f5b898d5ac9883dbf819a39de1445779c1da087d41'],
      ['55b9fd2a07e9dacdf6f897ba973e1b6ea901e6cb909b6d79d1f53c8e86c248e5'],
      ['92f3572d712e63d7712ac522e14d8a7414017a556f323f8913944201c86e5fed'],
      [
        'bbfdd53c04dbdd6b85de296e7492f53bb0ff96054235d794290cd562fb7fa8c4',
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'bbfdd53c04dbdd6b85de296e7492f53bb0ff96054235d794290cd562fb7fa8c4',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '05e45b12b1e099373ff76174a29c810e8dfbdff85e0e4e825f43de8342307ac2',
      ],
      ['ce8749bbf3fb55a8411f25b32be51cdf5b2f5151b35e68c83c2752cf8a717fb1'],
    ],
    joined: [
      'bbfdd53c04dbdd6b85de296e7492f53bb0ff96054235d794290cd562fb7fa8c4',
      '5345ef309b1bc976441ce4f5b898d5ac9883dbf819a39de1445779c1da087d41',
      '55b9fd2a07e9dacdf6f897ba973e1b6ea901e6cb909b6d79d1f53c8e86c248e5',
      '92f3572d712e63d7712ac522e14d8a7414017a556f323f8913944201c86e5fed',
      '72f8b57bd33e19beacf2ec595411f0ae5360e65492e7c6ef9afd7e110f1c797f',
      '588620b3453973deda0807ea811f932771f7f1c71fcd0eafc8026ba98baa058e',
      '3450533669171e5b956a9bc62fd8d683d2957b112b64a37ae8c279274281b5af',
      'ce8749bbf3fb55a8411f25b32be51cdf5b2f5151b35e68c83c2752cf8a717fb1',
    ],
  },
  {
    category: 'profanity',
    forms: [
      ['5f5564c4ee1522a45694c6c1fd352d2912ded94641a00c5db4ef4c0e09ad1726'],
      ['13c3e3c067d25e12d4aee3c184775e7f56faf4e005af57fb0ee5665068640bfb'],
      ['5977c64ed287e9077b968f61651239e98ce5b3f242642bdb04b3fa7e5fae7d36'],
      ['ba624ddd116f18406b1f1021967557179a6249957c008f8ac2471803fe755b72'],
      ['8eede9de5ce6cd6d1f61edc7ce0b92b3b2cbae09dd756190e79749101b447af0'],
      ['e497d8aa1f8fe1e5c0bbd8fa9be43b30319086596cea9b7c3249ee3dd9b43a88'],
      ['9bc2297a6b03d3973c5165617e9470cd3e6ebf1cd29f51b5079b42905567c45f'],
      ['5a3766c6ad7758cce9de01b8fcdbc29393060558cdc5bc99c9674bc3db6865ad'],
      ['03ad06be135408a8fd28101842f401574b1c9760c15d128c01c016e1849e1ec3'],
      ['e31ed6d1c01a36db87b77faa553a3ff0a01104c085df85dba18d84992b4b5dfc'],
    ],
    joined: [
      '5f5564c4ee1522a45694c6c1fd352d2912ded94641a00c5db4ef4c0e09ad1726',
      '13c3e3c067d25e12d4aee3c184775e7f56faf4e005af57fb0ee5665068640bfb',
      '5977c64ed287e9077b968f61651239e98ce5b3f242642bdb04b3fa7e5fae7d36',
      'ba624ddd116f18406b1f1021967557179a6249957c008f8ac2471803fe755b72',
      '8eede9de5ce6cd6d1f61edc7ce0b92b3b2cbae09dd756190e79749101b447af0',
      'e497d8aa1f8fe1e5c0bbd8fa9be43b30319086596cea9b7c3249ee3dd9b43a88',
      '9bc2297a6b03d3973c5165617e9470cd3e6ebf1cd29f51b5079b42905567c45f',
      '5a3766c6ad7758cce9de01b8fcdbc29393060558cdc5bc99c9674bc3db6865ad',
      '03ad06be135408a8fd28101842f401574b1c9760c15d128c01c016e1849e1ec3',
      'e31ed6d1c01a36db87b77faa553a3ff0a01104c085df85dba18d84992b4b5dfc',
    ],
    handleLengths: [5, 5, 6, 6, 6, 6, 7, 7, 5, 5],
  },
  {
    category: 'profanity',
    forms: [
      ['05e45b12b1e099373ff76174a29c810e8dfbdff85e0e4e825f43de8342307ac2'],
      ['d3cb1332b2feea151354857f36eb38c02efaed2dd72b9dd106d820215ae400e7'],
      ['a0761124969927ad420a64af6de82492c86a3477e8e19e7ea8ec3cf3882e43b7'],
      ['aa0b43703f70be245b405b74f23d6f2491197fe7f144c16e4af9c3d3dfd1f619'],
      ['1d4044cbf6bd70efe7fe31d550469f2d1481210da41b75cd2a3995156f9d8fb9'],
      ['7116250afeb5233238c373e773c50cc579e80d787103f196e25e7472103ca10e'],
      ['20db2e972a58646e26b5b751f80549ad910de770cb0dfaeda8c3d4b30f84f59a'],
      ['d0cfcdfdcc9134327c55d0e983f3a011748cf2f6c9e49edd4f04972bc22b2309'],
      ['52a2c76d65a10288754f30b807e5ae3d12a8ab24ed1f85ced2b38af2abee9506'],
      ['1c0426e9143f5b66dc27352eecd5f31afe37564501be831154e91ff1473fcf2c'],
      ['b9d5d70ed5c7aa6c0642a91173f0bb105c802c56534cb88717ed464c4a8b658a'],
      ['64b1a9115641373d114f9c72c0896c0b7add7fa133c118d42538363c53cac62b'],
    ],
    joined: [
      '05e45b12b1e099373ff76174a29c810e8dfbdff85e0e4e825f43de8342307ac2',
      'd3cb1332b2feea151354857f36eb38c02efaed2dd72b9dd106d820215ae400e7',
      'a0761124969927ad420a64af6de82492c86a3477e8e19e7ea8ec3cf3882e43b7',
      'aa0b43703f70be245b405b74f23d6f2491197fe7f144c16e4af9c3d3dfd1f619',
      '1d4044cbf6bd70efe7fe31d550469f2d1481210da41b75cd2a3995156f9d8fb9',
      '7116250afeb5233238c373e773c50cc579e80d787103f196e25e7472103ca10e',
      '20db2e972a58646e26b5b751f80549ad910de770cb0dfaeda8c3d4b30f84f59a',
      'd0cfcdfdcc9134327c55d0e983f3a011748cf2f6c9e49edd4f04972bc22b2309',
      '52a2c76d65a10288754f30b807e5ae3d12a8ab24ed1f85ced2b38af2abee9506',
      '1c0426e9143f5b66dc27352eecd5f31afe37564501be831154e91ff1473fcf2c',
      'b9d5d70ed5c7aa6c0642a91173f0bb105c802c56534cb88717ed464c4a8b658a',
      '64b1a9115641373d114f9c72c0896c0b7add7fa133c118d42538363c53cac62b',
    ],
  },
  {
    category: 'profanity',
    forms: [['c3b65f8156ea049cce296df32675170967cfbdfef79809c382adbf5f66f0dd96']],
    joined: ['c3b65f8156ea049cce296df32675170967cfbdfef79809c382adbf5f66f0dd96'],
    handleLengths: [7],
  },
  {
    category: 'profanity',
    forms: [
      [
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        'ba2b0c2c9f330a72b3fd7dbee42c8afa9bebf4d3b0e58d538fe2e706d9260553',
      ],
      [
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        '65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2',
        'ba2b0c2c9f330a72b3fd7dbee42c8afa9bebf4d3b0e58d538fe2e706d9260553',
      ],
      [
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        'ba2b0c2c9f330a72b3fd7dbee42c8afa9bebf4d3b0e58d538fe2e706d9260553',
      ],
    ],
    joined: [
      'ab8ad5f7df44267598a826ebe7746c21364573f54bbf048a16942624b78f1922',
      '2db2b773d029222412175a18cf10f7e3b5c42f0a846cf2ab31bc9cddbcb883f5',
      '75ebb1c1ac136ef99bb47f428875ff7bf41be1d24336dd27c7923cd04e2253cd',
    ],
    handleLengths: [12, 13, 14],
  },
  {
    category: 'profanity',
    forms: [['5361e2902d88b3527d82b5e955c855032527a9414ff19020560bcb7c3fb82233']],
    joined: ['5361e2902d88b3527d82b5e955c855032527a9414ff19020560bcb7c3fb82233'],
  },
  {
    category: 'profanity',
    forms: [
      ['e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd'],
      ['683303a177358ed6e696a515f6f25093dbdfded875ebbd8d162b710be08bc2e8'],
      [
        'f61f5c5e22749aeba2bd920352dbd4c9f63e0ebaed6df623b09c836ffcbec2eb',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
    ],
    joined: [
      'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      '683303a177358ed6e696a515f6f25093dbdfded875ebbd8d162b710be08bc2e8',
      '4bd92ece67aab9c1f8da1b2ec36fead4a369e349b2d31685b9f5f16a21cb32ee',
    ],
  },
  {
    category: 'insult',
    forms: [
      ['489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085'],
      ['6ada028b2d096d946ddfb32453673d6116a10d664593ca86b73b6de12e060355'],
      ['f2199babc9b6bae8bd5900d6826ac0524301b9617855db87dfd5620f58b3c233'],
      ['ae86fc7e423363b22f429fad2fad2a4b0b4db3ff53f299219696e0cef7474303'],
      ['03839fb7df3bb14f867f3ad2e64ce0612dd4b347c280ddbc8b571f77be680d08'],
    ],
    joined: [
      '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      '6ada028b2d096d946ddfb32453673d6116a10d664593ca86b73b6de12e060355',
      'f2199babc9b6bae8bd5900d6826ac0524301b9617855db87dfd5620f58b3c233',
      'ae86fc7e423363b22f429fad2fad2a4b0b4db3ff53f299219696e0cef7474303',
      '03839fb7df3bb14f867f3ad2e64ce0612dd4b347c280ddbc8b571f77be680d08',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        'd2087c1cd49ecf4b72d1d0b7f3385b127b2de76f97a6b225257ac946f81238ec',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        '14849e99052714c9abcce3a5a02c322c022c1e27c28cb672aa520820002722ab',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        'd2087c1cd49ecf4b72d1d0b7f3385b127b2de76f97a6b225257ac946f81238ec',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e811eb7830249bae4b61145ae6e5f0933d7f890570d6ead6e78f89f04fd6aeb5',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        '14849e99052714c9abcce3a5a02c322c022c1e27c28cb672aa520820002722ab',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e811eb7830249bae4b61145ae6e5f0933d7f890570d6ead6e78f89f04fd6aeb5',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        '0caad04c6b091e442a7197d216e749afd84e0779829f0a070d021bdb23171bbb',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        '69073b15cd6065f3996252ee6e8e362feba26df1d98f3898ebe4e33654fe4754',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
      [
        'b4bdc848109722a383d0a972c6eb859f2abd29565b8c4cc7199e7c9eb708f1b7',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        '489a845537412def5431c0b0022bac0022dd00dadcb971bf375c862e5b1f0085',
      ],
    ],
    joined: [
      '8f78c0e64402db4305347a459dc4006b4b01fbc4563b899cb07aacbe86b3648f',
      '7f785f4b1f8187cbe43c71cce02fffe946056cfe865bcde8cd7c202341ee0a61',
      'dd0ed55ed54b5298f0d69e66d2aa74f021aef840e272489a90d113117c9d994f',
      '1ff6b8851f856b540599775f748cb4d7d5d30ceb421e81ee3fdd57f5bb04085a',
      '2e501d79b41192fa87e962bb8ea9ebbb665a78fd93672aab98ca4a2b36110f5d',
      'ed1db8e61c5297f1450128e70108981dbb8c8eab19eb345ddf9ce44ecd9e3031',
      '4bab2f1f8aac3d2cd155154d479079f33bc454aa172308c63949ea9201da311a',
    ],
    handleLengths: [11, 11, 14, 14, 9, 9, 8],
  },
  {
    category: 'insult',
    forms: [
      [
        'd2087c1cd49ecf4b72d1d0b7f3385b127b2de76f97a6b225257ac946f81238ec',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e5ec63e333f5be825c2676b35fb66b8be7a89bc85711f7a29414fdab77ce6571',
      ],
      [
        '14849e99052714c9abcce3a5a02c322c022c1e27c28cb672aa520820002722ab',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e5ec63e333f5be825c2676b35fb66b8be7a89bc85711f7a29414fdab77ce6571',
      ],
      [
        '0caad04c6b091e442a7197d216e749afd84e0779829f0a070d021bdb23171bbb',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e5ec63e333f5be825c2676b35fb66b8be7a89bc85711f7a29414fdab77ce6571',
      ],
      [
        'b4bdc848109722a383d0a972c6eb859f2abd29565b8c4cc7199e7c9eb708f1b7',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'e5ec63e333f5be825c2676b35fb66b8be7a89bc85711f7a29414fdab77ce6571',
      ],
    ],
    joined: [
      '1e219440eb77f4f45f98b5ebaf0fc5296af9f594f93773b424a9744b464a086b',
      '53c2fab7ba4610e0cc42b63654a2572de127166f64aeac8ba46b70849ae03a21',
      '49d2d66ff91c64745deda37d055234adb0491c0dec1349bf5eff38c836ec49c4',
      '03c11c5a1112f74aa4be382bb4ef954fcb50efbb03cc093abe07be187f5b4e9f',
    ],
    handleLengths: [15, 15, 13, 12],
  },
  {
    category: 'insult',
    forms: [['c28a08a1a507d5c8ce1a24a6544850290d534e8da2ba92d04025a8dd199e3cd5']],
    joined: ['c28a08a1a507d5c8ce1a24a6544850290d534e8da2ba92d04025a8dd199e3cd5'],
  },
  {
    category: 'insult',
    forms: [
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '43a4caf12a4ce405524d1157a89a0ae821e1f7e1fe98dda4fe84c88301a621ef',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '861ef6e67fa0aa2a6b7dd0908730db6016a833b99a7fff475bcbc0e228e40343',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '43a4caf12a4ce405524d1157a89a0ae821e1f7e1fe98dda4fe84c88301a621ef',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
      [
        '43a4caf12a4ce405524d1157a89a0ae821e1f7e1fe98dda4fe84c88301a621ef',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
      [
        '861ef6e67fa0aa2a6b7dd0908730db6016a833b99a7fff475bcbc0e228e40343',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        'e67be79550661604d9b9c646911c80d74f6c691613224c207fa7088c20698acd',
      ],
    ],
    joined: [
      'b904fad0e4a1223719285c0b3a350c5a98e00a39d5c36d2486bf27d139a33d33',
      'e777bb2f45f9e021f900b61ff9b86d243c50f934764a808424203b504a02ccf0',
      '5abad116dc2602ac4f1e588bbad4c049638a6373de81360f126215d0a40a288c',
      '418695c531ac59ded6c8e2c434a266e2db95497540315a8c0aa05cc3a2265bdb',
      'b797ab0fece9cab050d1d78027a889e9731a54b8772880063e40c550d22715a1',
    ],
    handleLengths: [12, 11, 15, 9, 8],
  },
  {
    category: 'insult',
    forms: [
      ['34b9542ac071c8728df5bffef58e793e8e741b2f2af5a8715e8e4388fe5b11aa'],
      ['49b5e39c84ac95ca92d5568b5ef6c7f065333ed8afca490121d2a8165741a01a'],
      ['0cbedf814a5c70c6d387f1d2134da48aebb75801615d96309769c574e0c86c8e'],
      ['53f4473a7594a4cd4d2350f13bd868ecef408028e855b1ec88000eb1d3fdde2a'],
    ],
    joined: [
      '34b9542ac071c8728df5bffef58e793e8e741b2f2af5a8715e8e4388fe5b11aa',
      '49b5e39c84ac95ca92d5568b5ef6c7f065333ed8afca490121d2a8165741a01a',
      '0cbedf814a5c70c6d387f1d2134da48aebb75801615d96309769c574e0c86c8e',
      '53f4473a7594a4cd4d2350f13bd868ecef408028e855b1ec88000eb1d3fdde2a',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '5f5564c4ee1522a45694c6c1fd352d2912ded94641a00c5db4ef4c0e09ad1726',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '13c3e3c067d25e12d4aee3c184775e7f56faf4e005af57fb0ee5665068640bfb',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '5f5564c4ee1522a45694c6c1fd352d2912ded94641a00c5db4ef4c0e09ad1726',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '13c3e3c067d25e12d4aee3c184775e7f56faf4e005af57fb0ee5665068640bfb',
      ],
    ],
    joined: [
      'd50e01c91f8bce3b81d22a4fbf6569390ac5a332d8ce01bd43195c92f0276dd2',
      'dddeee0584659c3b534bd001771ed1984c67eccde4404ba381c488b3acfab2fc',
      'e0080251fa2e6a4918af466d6c20c8e0e5801aaaf1278d182c8467d3a89b12ad',
      '022dff5633aeed0f1d6d529799b97e25cb50511dbfac7e261ae1f87303fb58ee',
    ],
    handleLengths: [10, 10, 10, 10],
  },
  {
    category: 'insult',
    forms: [
      ['02cdc5daeafbc4ddc3eb948c1ee8bc6c874e326e6795be8849a24f9b4d97c700'],
      ['0483fa440a400ad0120c0c0401755dc4d51d0d15825550b9b895eae72100c451'],
    ],
    joined: [
      '02cdc5daeafbc4ddc3eb948c1ee8bc6c874e326e6795be8849a24f9b4d97c700',
      '0483fa440a400ad0120c0c0401755dc4d51d0d15825550b9b895eae72100c451',
    ],
  },
  {
    category: 'insult',
    forms: [['e5b1f88e5f7028a93c480689bcd375004f6fb467535cf9e6e2e6908abe96ede8']],
    joined: ['e5b1f88e5f7028a93c480689bcd375004f6fb467535cf9e6e2e6908abe96ede8'],
  },
  {
    category: 'insult',
    forms: [
      ['702543ba8598564d3834a09982b42f3343249933e59228c0a15bb0e822a0aef5'],
      ['78ac9da488dd05e2a2e073f385c7d89925a5b0e878f844e2f74cfbe5f13466b2'],
      ['37fd748e8480e176cf7522484d3bde4755080a542dc8e3669f65743e528d3f6c'],
      ['fbdde06bf7e33bcfca147c5a065d4e00e9dbd5235358344e0bbe0a0a4cb694f0'],
      ['0ecee35995690d0406e21430f392e90384101df5da12a25cc066bc35e6032fb5'],
    ],
    joined: [
      '702543ba8598564d3834a09982b42f3343249933e59228c0a15bb0e822a0aef5',
      '78ac9da488dd05e2a2e073f385c7d89925a5b0e878f844e2f74cfbe5f13466b2',
      '37fd748e8480e176cf7522484d3bde4755080a542dc8e3669f65743e528d3f6c',
      'fbdde06bf7e33bcfca147c5a065d4e00e9dbd5235358344e0bbe0a0a4cb694f0',
      '0ecee35995690d0406e21430f392e90384101df5da12a25cc066bc35e6032fb5',
    ],
    handleLengths: [6, 7, 8, 10, 8],
  },
  {
    category: 'insult',
    forms: [
      ['ab54ba640504b1c93237fa996cc053f9e41c1ccfe1c8400ee3cdab489bfde950'],
      ['36106b2d067dbaa5139e16c9c0fe7c11b781183dd06e9b7b52e3e5cccb73a0c7'],
      ['9c57154d146256ddfef7b21d0063b5b47a64d6483fe8201b10d1977678d468eb'],
      ['74470680d01729f959cd0a8a9c86b5e5739afd38d3372620e0c4c42112965f9e'],
      ['e80e26d9aae4f07a39f55bce0220c303abfb56d2234b9071a515167e8b8d72fa'],
    ],
    joined: [
      'ab54ba640504b1c93237fa996cc053f9e41c1ccfe1c8400ee3cdab489bfde950',
      '36106b2d067dbaa5139e16c9c0fe7c11b781183dd06e9b7b52e3e5cccb73a0c7',
      '9c57154d146256ddfef7b21d0063b5b47a64d6483fe8201b10d1977678d468eb',
      '74470680d01729f959cd0a8a9c86b5e5739afd38d3372620e0c4c42112965f9e',
      'e80e26d9aae4f07a39f55bce0220c303abfb56d2234b9071a515167e8b8d72fa',
    ],
    handleLengths: [6, 6, 7, 8, 8],
  },
  {
    category: 'insult',
    forms: [
      ['e026b556f630e9996951555f5bc72f1f67b6e0c9780ae721a101ccb0f2957c46'],
      ['c8bf74b04790cbc4c225aa1839b30738e92ce6cfef38382dadd524d29817f4c2'],
    ],
    joined: [
      'e026b556f630e9996951555f5bc72f1f67b6e0c9780ae721a101ccb0f2957c46',
      'c8bf74b04790cbc4c225aa1839b30738e92ce6cfef38382dadd524d29817f4c2',
    ],
    handleLengths: [7, 7],
  },
  {
    category: 'insult',
    forms: [
      ['06e0bd5e046ec3828806f3087ec92260b2af1d435ce7962bb98ddbfb4496d809'],
      ['f8cce9178681e5015bd81e38fe0db8d361e13c45484d6bfe523d9dabd2c3fd4e'],
    ],
    joined: [
      '06e0bd5e046ec3828806f3087ec92260b2af1d435ce7962bb98ddbfb4496d809',
      'f8cce9178681e5015bd81e38fe0db8d361e13c45484d6bfe523d9dabd2c3fd4e',
    ],
    handleLengths: [7, 7],
  },
  {
    category: 'insult',
    forms: [
      ['7f4bfdebf1a23458b860771bd2c1715a910fd91f691c4c195d35ccb9a5e4f6cc'],
      ['0fc8c263b45e3f4443a778bee2eb470779a9638a6e51b4146f0135219cc167e7'],
      ['f24794916a041e12a313c2f2d401fb31672e5033d103d649825f48c6a818a5f0'],
      ['a6ac83f951fe1bbfd7e349d8ab011b994bc0159331e355a7756405dbce04ce57'],
      ['243beb15ff585e58ac13b30b06f8b774e5064c99a65378d23176e50bd2cf6781'],
    ],
    joined: [
      '7f4bfdebf1a23458b860771bd2c1715a910fd91f691c4c195d35ccb9a5e4f6cc',
      '0fc8c263b45e3f4443a778bee2eb470779a9638a6e51b4146f0135219cc167e7',
      'f24794916a041e12a313c2f2d401fb31672e5033d103d649825f48c6a818a5f0',
      'a6ac83f951fe1bbfd7e349d8ab011b994bc0159331e355a7756405dbce04ce57',
      '243beb15ff585e58ac13b30b06f8b774e5064c99a65378d23176e50bd2cf6781',
    ],
    handleLengths: [7, 7, 8, 10, 10],
  },
  {
    category: 'insult',
    forms: [['240816c9d94783e73942a7ab9a6a6340b1381227c7616ef66f7c1ffb1466c12d']],
    joined: ['240816c9d94783e73942a7ab9a6a6340b1381227c7616ef66f7c1ffb1466c12d'],
    handleLengths: [7],
  },
  {
    category: 'insult',
    forms: [
      ['d0e51c388328d2a8ea18646dc7a43bdb05dc7dac51e2e4b81b6d1a4305d8f4d8'],
      ['63c2402511b8bccd948e5d995b2696a98df1ed7c4780168d95b553c2b209b5dd'],
      ['68de75ccbe6d6d34a99180cb101b65abc3b9c96096eab1beea75f097f93d6ec3'],
      ['04e38bb9ebd82ac82b0ee5a6f7f0136cd73edcf6dbd890cec77caa206d69ebaf'],
      ['77bf3701bbddde57a059598843258cda8b08b4778b3d6040cf41d490074f8dea'],
      ['4214b9929a42a5779722f57fb1dc08a96ed4a97088a52304983bd5100723382d'],
    ],
    joined: [
      'd0e51c388328d2a8ea18646dc7a43bdb05dc7dac51e2e4b81b6d1a4305d8f4d8',
      '63c2402511b8bccd948e5d995b2696a98df1ed7c4780168d95b553c2b209b5dd',
      '68de75ccbe6d6d34a99180cb101b65abc3b9c96096eab1beea75f097f93d6ec3',
      '04e38bb9ebd82ac82b0ee5a6f7f0136cd73edcf6dbd890cec77caa206d69ebaf',
      '77bf3701bbddde57a059598843258cda8b08b4778b3d6040cf41d490074f8dea',
      '4214b9929a42a5779722f57fb1dc08a96ed4a97088a52304983bd5100723382d',
    ],
    handleLengths: [9, 9, 12, 10, 6, 12],
  },
  {
    category: 'insult',
    forms: [
      ['cc06226a2bacacbe46235fcee060b73f70a8c559771f4544e97960e660b99f08'],
      ['5901cc543440de26e46ea910d64ab7313dd7d8d258c680afff5dcc16342d506e'],
    ],
    joined: [
      'cc06226a2bacacbe46235fcee060b73f70a8c559771f4544e97960e660b99f08',
      '5901cc543440de26e46ea910d64ab7313dd7d8d258c680afff5dcc16342d506e',
    ],
  },
  {
    category: 'insult',
    forms: [
      ['11cfb3301e3d68799522330e466fd36bda0369d939a21b2617380fa358e167c5'],
      ['1080c3938c9cbc9de00e26fdd37b2e04964f44165c0a2229a02d532b2b33cde3'],
      ['22ea759b3cb971714e454ae7748e265e9c643f33551b1204ce0873c6ebadf7c3'],
      ['7c9ccdcf2d9a2a0c8f0c26feeab2aa3755c2da01faa995fab546da645274e190'],
    ],
    joined: [
      '11cfb3301e3d68799522330e466fd36bda0369d939a21b2617380fa358e167c5',
      '1080c3938c9cbc9de00e26fdd37b2e04964f44165c0a2229a02d532b2b33cde3',
      '22ea759b3cb971714e454ae7748e265e9c643f33551b1204ce0873c6ebadf7c3',
      '7c9ccdcf2d9a2a0c8f0c26feeab2aa3755c2da01faa995fab546da645274e190',
    ],
    handleLengths: [10, 10, 13, 13],
  },
  {
    category: 'insult',
    forms: [
      ['6954b2217d69a9191034b49a02099b8c2b4563013fa9e9c3c30cfb41e4024602'],
      ['855c35914e13e5c5313192ecb645c11a0d30be1621f750910a6fb2e07e05531f'],
      ['1ebf884e1ae0c3636baf15eb02b8ca93c3abb36eff863fb6d5c06be97c764913'],
    ],
    joined: [
      '6954b2217d69a9191034b49a02099b8c2b4563013fa9e9c3c30cfb41e4024602',
      '855c35914e13e5c5313192ecb645c11a0d30be1621f750910a6fb2e07e05531f',
      '1ebf884e1ae0c3636baf15eb02b8ca93c3abb36eff863fb6d5c06be97c764913',
    ],
    handleLengths: [5, 6, 6],
  },
  {
    category: 'insult',
    forms: [
      ['7914cfec36d5c4c544a4db845d055c23fc129689e5d7cfcaeee0354699439dfc'],
      ['18371c148d70ab3a65ab3300cd7acafd2c9c4631aeeba7a0486695bf9ed1b015'],
    ],
    joined: [
      '7914cfec36d5c4c544a4db845d055c23fc129689e5d7cfcaeee0354699439dfc',
      '18371c148d70ab3a65ab3300cd7acafd2c9c4631aeeba7a0486695bf9ed1b015',
    ],
    handleLengths: [9, 9],
  },
  {
    category: 'insult',
    forms: [['83c3fb5c73c8d9802c62ca737dce31a0a1ea3ddafaec59c3b6cbcec1284f7700']],
    joined: ['83c3fb5c73c8d9802c62ca737dce31a0a1ea3ddafaec59c3b6cbcec1284f7700'],
    handleLengths: [7],
  },
  {
    category: 'insult',
    forms: [['2766bda465250dfe188da050efb9bad56fa5d735370f68d6ef7e7fc806da9c5e']],
    joined: ['2766bda465250dfe188da050efb9bad56fa5d735370f68d6ef7e7fc806da9c5e'],
    handleLengths: [7],
  },
  {
    category: 'insult',
    forms: [['6b801cb8a8a13d13c9aa5fd4fb032d728c86e2e9a55989194a315137a6657846']],
    joined: ['6b801cb8a8a13d13c9aa5fd4fb032d728c86e2e9a55989194a315137a6657846'],
  },
  {
    category: 'insult',
    forms: [
      ['36765f2934f0e5e8b621d4220b271fff915d0a1446f993a0dc6ea1f531b91ac5'],
      ['09ab226e8f07b0a7f484f5b5eec2257ca2e4f865bedbb1fddd755426ae5902e2'],
    ],
    joined: [
      '36765f2934f0e5e8b621d4220b271fff915d0a1446f993a0dc6ea1f531b91ac5',
      '09ab226e8f07b0a7f484f5b5eec2257ca2e4f865bedbb1fddd755426ae5902e2',
    ],
    handleLengths: [10, 10],
  },
  {
    category: 'insult',
    forms: [['117d2b58f73c7ec9288ccba9c62bff320a740b140bf082b2135eb15af74b3605']],
    joined: ['117d2b58f73c7ec9288ccba9c62bff320a740b140bf082b2135eb15af74b3605'],
    handleLengths: [7],
  },
  {
    category: 'insult',
    forms: [['65e915859e00820310539db02ae38ace0f08736c091d15750f447e26b67fec1e']],
    joined: ['65e915859e00820310539db02ae38ace0f08736c091d15750f447e26b67fec1e'],
    handleLengths: [7],
  },
  {
    category: 'insult',
    forms: [
      [
        '3cf4897608d8ae2d9ccd9e087be19fc7ba962b9ae38e784f1b770eea3394645f',
        'b2ca8c730201f9091cf78431eb63eb1a0e8908d04bac6ce244fdbb6dc159dd78',
      ],
    ],
    joined: ['a68bca257d19e8b9a667b216a90d9f6abb4e69f937da708d36867bebbd21e1ac'],
  },
  {
    category: 'insult',
    forms: [
      [
        'a101beba8fa6975ec394f124182427a4d83629f49226c3e71c1d5183ae22fe50',
        '4280f6bfd41c766e44a7358ff7efca7ba37ae980b5fd45364f9777cf197a79b2',
      ],
      [
        '52b490be7ef6bf808a2c1c0d84a88e4ab7293717b2b68bfa82669997f6ce9670',
        '7646192f670c19de9bfff24963d5e7ce0b478da3ea63e8038dcafee5ca2c91be',
      ],
    ],
    joined: [
      'bac643e8b4dcf151b6e8253cee00f8519a28a522939daf201adc97716ca5d922',
      '294eeffdb618033764aaae206287a0d809b752ecb9cd2d37138debc0685cffa2',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '08eda06be5d16a70d541460ad1924f3e0ebef29289014e5052c0cdcdd814ad5a',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        '7bb813331895b1bfe0d3cb3edcd8b1289a8ad600d83c3f01e92ede811e370722',
      ],
    ],
    joined: ['b11955e65bdaacb6abcc01c3b47a0fe8e2bf4d9b8f103501066b33f95609a9b9'],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '547dcda36f49a3462cf4d1657659421be90acf0b7b3b77658aa0a9c58ff1fe78',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '9ca5cf35db33571b965a1cff067908838568a98c545281b11e0fc48386a6b9e6',
      ],
    ],
    joined: [
      '5e0ef181f7a91dd160e683f0250ab53952558def5df14eae7c64e387f939c4e5',
      '12e9dbca59261578921cd8fed8819e73e45e9b4a20c8f8c4ca4befb1ec79d8c3',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'cbeb0102202435f4c80d0ce7c5fb54070a2ab0a7e98f0fc57efd4005561a20c0',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'cbeb0102202435f4c80d0ce7c5fb54070a2ab0a7e98f0fc57efd4005561a20c0',
      ],
    ],
    joined: [
      'b61980ddb64c2d4c497be339c83c78d7c4862ec8cb5607c673adcf27f231ae69',
      'cbfc5c8770b29610730a792c76a71d47929c10042bb35b5e6045aa967d054871',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'ed4ed23ecdf451a717687c8fc3184b718f31724fff20b3c86e6764f55abc2f20',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'bfb36471bad42211caa746ea117741fe52ee0388e11dc03b52a8894ed2aac50b',
      ],
    ],
    joined: [
      '583f44c2227e76bd8d035a7dc57ab96fd17dff7d7de65ded9bdfb89e0f68535e',
      '3dfd923a7dc03405053083c269cac51517f880a20b4e3037e73aa2cdde6f5e04',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '1661113c4f239e8014fd0d91475b8313ddeee6d7c520042624ce4427c521851b',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '1661113c4f239e8014fd0d91475b8313ddeee6d7c520042624ce4427c521851b',
      ],
    ],
    joined: [
      'bf3707c5d765421c25f815f6e0e6bfbe9e2a8f184c46181bc01984f132d6a179',
      '504cdb7bc430c76947cf374ddcb527b71de2b1910cd09e997c941913578319f5',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '4a79e307cf12b948a9095e16ae39c594d9dae1fce69604e956aeb77f2706e2a3',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'd88da6e9f587da04214b6b6c210ef90226e46b4842ee7cea63c60ada07fbde08',
      ],
    ],
    joined: [
      '9910b98c9ec71318e2abb9ea055e32b0e358dd41946f23afb5071ee0732ee5f3',
      '25959f04713caf13f3180f4b6fd3954b2530c1a4c68edbcf08d4d987a5acde7d',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'f2aa9d19448f9ac9a981bd695cfb3bdfb15cfd4ae2bc8269928374de81d8a6c8',
      ],
    ],
    joined: ['38d573fcb3b0a07ac877a9451b2867991524bb3cd27b850fc57309a88c66dcb5'],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '7646192f670c19de9bfff24963d5e7ce0b478da3ea63e8038dcafee5ca2c91be',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '4280f6bfd41c766e44a7358ff7efca7ba37ae980b5fd45364f9777cf197a79b2',
      ],
    ],
    joined: [
      'fbef7d4af7a392b38fccc1fc564fea8a52a15411578c9a8dcde107adafdd9a3c',
      'be8e70f679e8a460e0ef8b07f1653b36effe19d3ae6b18a884a691d746c67bf8',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
    ],
    joined: [
      'cc9407194315f2bffd529d8950e47ed877587ce2c091cf6a7ed3d9ef22b5b615',
      'fac833961bdc3dfe2653829c8ad1f9bc28d8541de5872add5ea961f9760b8e6f',
    ],
  },
  {
    category: 'insult',
    forms: [
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '549aa67ca56e8878058d3d6e93b38f6e97fd23695f7d6516561f48c2465ecbc2',
      ],
    ],
    joined: ['bac1fbc91f541d0f927269e6e305bfe59e646edd146430ba0415fd68ba2e9cd8'],
  },
  {
    category: 'insult',
    forms: [
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '571363723e1062b31f38a7f960c79d96d7a598586b71c58f9b7644a1bf578709',
      ],
    ],
    joined: ['d611ace35baf22845ef7af36d9657a74b3ae32f1bd64c9b8d1994d2c1225774f'],
  },
  {
    category: 'insult',
    forms: [
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '8b99af47cc688f921dfaa4e1792236bb4623318593a23046c31ffe9335a8114e',
      ],
    ],
    joined: ['873b7f16514d00e6815a34d9f3a4fc7914be30ac41389b962c2a92d5956e13e5'],
  },
  {
    category: 'insult',
    forms: [
      [
        '66cf042eb95cec13662628b0bb006e3258bfc39ae0f7b0f6c394900b17651059',
        '41824414be8e66e4c1774b2819cefa247685f81b541b8031a6d42adf8f8b1639',
      ],
      [
        '66cf042eb95cec13662628b0bb006e3258bfc39ae0f7b0f6c394900b17651059',
        'ca02844258c2d36f69b967c5b31e7fbba238ad4d75f80fd5b9da4c932ab84e7b',
      ],
    ],
    joined: [
      'eb32813cd896d3d7cc03d223d24de5662c2c02950e62cae8a0a31f0e011ea53c',
      '70b6d1203cedae95316f30438539d3b0e393f1a64f473f868341bfa695b09b11',
    ],
  },
  {
    category: 'hate',
    forms: [
      ['e51d490d2db8ad9597e82fcdd77a0dd6b4c2b9a56aca1c6fe11065c62d2b4d4a'],
      ['17fbaa045b4a645607845e5ffb5718f927a949b6f1b6ff6caa37c5d35efabd4c'],
      ['e9c276352ae61ffabadc9998fdcac5ad96df04f27400968b6cd5e9cc38ca652c'],
      ['04bd4c6424e0a63fff0bf2f53f4c76802bd5d67f28365bea27cd58d06d84cd69'],
      ['6be92a6092fe18dc090060c31519d22122ddcb832f0450fbd12cb6256857fe4d'],
      ['476792454c942659cc20456a4fe76d158cfae451f801ea42043e10aee88d0f3a'],
    ],
    joined: [
      'e51d490d2db8ad9597e82fcdd77a0dd6b4c2b9a56aca1c6fe11065c62d2b4d4a',
      '17fbaa045b4a645607845e5ffb5718f927a949b6f1b6ff6caa37c5d35efabd4c',
      'e9c276352ae61ffabadc9998fdcac5ad96df04f27400968b6cd5e9cc38ca652c',
      '04bd4c6424e0a63fff0bf2f53f4c76802bd5d67f28365bea27cd58d06d84cd69',
      '6be92a6092fe18dc090060c31519d22122ddcb832f0450fbd12cb6256857fe4d',
      '476792454c942659cc20456a4fe76d158cfae451f801ea42043e10aee88d0f3a',
    ],
  },
  {
    category: 'hate',
    forms: [
      ['a8b31461d3e070922fbd858515be7147ee4ac25bc6af9e2e810425c4d476ced5'],
      ['62ee10607af8b327bb6dd45f1efa3f1bb33b9e5210ebd34c54160d637e63086d'],
      ['8432c4d2b340dfd1d84a972f93345b09d7fdbc71604962c139a511994282e826'],
      ['3c5532dafb39c84fd3eded28a12f794b6a435c3a616ac29375a6472a2a9f57cc'],
      ['19be36d725e2d6222a8370305fae56a6816f10ac17ffb7b90f397d058ca9eed4'],
    ],
    joined: [
      'a8b31461d3e070922fbd858515be7147ee4ac25bc6af9e2e810425c4d476ced5',
      '62ee10607af8b327bb6dd45f1efa3f1bb33b9e5210ebd34c54160d637e63086d',
      '8432c4d2b340dfd1d84a972f93345b09d7fdbc71604962c139a511994282e826',
      '3c5532dafb39c84fd3eded28a12f794b6a435c3a616ac29375a6472a2a9f57cc',
      '19be36d725e2d6222a8370305fae56a6816f10ac17ffb7b90f397d058ca9eed4',
    ],
    handleLengths: [6, 9, 7, 9, 8],
  },
  {
    category: 'hate',
    forms: [
      ['00ff5a54bed0a133db9266c10d392beab53d0bfeec7033c7adf185fd51ab80d7'],
      ['37116e0708abfe37158e8341c4fd096a3fb426b6c2aa7f18ab27f87e362e61a9'],
    ],
    joined: [
      '00ff5a54bed0a133db9266c10d392beab53d0bfeec7033c7adf185fd51ab80d7',
      '37116e0708abfe37158e8341c4fd096a3fb426b6c2aa7f18ab27f87e362e61a9',
    ],
    handleLengths: [7, 10],
  },
  {
    category: 'hate',
    forms: [
      ['71d6a1bcece6ace76a93facc39e6fe1a1c651e1d6e7e19e81b41e64600f16067'],
      [
        '898e3115c03159e9a415a811d4d09543753d201f1899f10e8ec61fad4302d9b5',
        '2ea7cc9ac962a4e8c5c29ce4ab35f473557e9b0ffbe1591aea97f71d7d4c4ee3',
      ],
    ],
    joined: [
      '71d6a1bcece6ace76a93facc39e6fe1a1c651e1d6e7e19e81b41e64600f16067',
      '360ba75bd0de379ab4d0a273efe48ecd34c10047544439215f44045084e51d97',
    ],
    handleLengths: [7, 10],
  },
  {
    category: 'hate',
    forms: [
      ['eb2abb526533e332ac98c8f82dec0acb0f58efc39115b5e0055de812684e442c'],
      ['e03a77e2dc359ac9b1917484ee9c94383001aa9999cb7bf0caa138a4e6ba6bca'],
      ['6bc3fc989df856cc85b009f4e1bdb12eaa4d5f36d609bb95503bdf9799d7ffe5'],
    ],
    joined: [
      'eb2abb526533e332ac98c8f82dec0acb0f58efc39115b5e0055de812684e442c',
      'e03a77e2dc359ac9b1917484ee9c94383001aa9999cb7bf0caa138a4e6ba6bca',
      '6bc3fc989df856cc85b009f4e1bdb12eaa4d5f36d609bb95503bdf9799d7ffe5',
    ],
    handleLengths: [7, 8, 8],
  },
  {
    category: 'hate',
    forms: [['f4e02a9d6dec56bea1637207266e29dfa9dda1971ecdcaddb8b42149e050c15b']],
    joined: ['f4e02a9d6dec56bea1637207266e29dfa9dda1971ecdcaddb8b42149e050c15b'],
    handleLengths: [8],
  },
  {
    category: 'hate',
    forms: [
      ['24770985b359c8d85e0f615413d8a305f49961865455f4f8a3d0f65c078102c0'],
      ['3f5763f3599a864b79c9bab19f2d26a289ecfbd193178d96f7fd517127c7e5a6'],
      ['421b44c221f896b4e8552201f81e06006f352377683615dbcd7ac8b9c2b4bc65'],
    ],
    joined: [
      '24770985b359c8d85e0f615413d8a305f49961865455f4f8a3d0f65c078102c0',
      '3f5763f3599a864b79c9bab19f2d26a289ecfbd193178d96f7fd517127c7e5a6',
      '421b44c221f896b4e8552201f81e06006f352377683615dbcd7ac8b9c2b4bc65',
    ],
    handleLengths: [7, 7, 8],
  },
  {
    category: 'hate',
    forms: [
      ['90e8ac6efdec32cc31ec87f6477db3d3019af80cbafe852f8efdc636da1670a2'],
      ['6b27e1c97131eac56d81f31047738b2326a7de9edeb90b0478119675f422a856'],
    ],
    joined: [
      '90e8ac6efdec32cc31ec87f6477db3d3019af80cbafe852f8efdc636da1670a2',
      '6b27e1c97131eac56d81f31047738b2326a7de9edeb90b0478119675f422a856',
    ],
    handleLengths: [8, 8],
  },
  {
    category: 'hate',
    forms: [
      ['0da9363e07820afc7b77fea98c90b7249a23ce544f8df22a7b37620a9bda1ed0'],
      ['adfb510ad53730614118a3fd795f53d5b4315e2c234efc12c79ceeb38d0f7cd6'],
      ['424e409b93761259840a88c3a0ecf6b4e11182362166c33067f4f264f92e0816'],
      ['845b288954da23e81b1ce7344f9008dfab74262c7e3d57de0c12d2f5dbef8598'],
    ],
    joined: [
      '0da9363e07820afc7b77fea98c90b7249a23ce544f8df22a7b37620a9bda1ed0',
      'adfb510ad53730614118a3fd795f53d5b4315e2c234efc12c79ceeb38d0f7cd6',
      '424e409b93761259840a88c3a0ecf6b4e11182362166c33067f4f264f92e0816',
      '845b288954da23e81b1ce7344f9008dfab74262c7e3d57de0c12d2f5dbef8598',
    ],
    handleLengths: [9, 9, 12, 12],
  },
  {
    category: 'hate',
    forms: [['d614b75c1e677f05cfed120367c5339bfad3b3c1449f6c0e83b751b10c5eddf3']],
    joined: ['d614b75c1e677f05cfed120367c5339bfad3b3c1449f6c0e83b751b10c5eddf3'],
    handleLengths: [10],
  },
  {
    category: 'hate',
    forms: [
      [
        '48bf115f41709ed26a6c29817e1e6f7b098ae6fde20922272fd3bcd9bb3edd11',
        '888df6d1572d02bc1a80b3f720916b5e349ca49f4104fc6378f0678b8816ed30',
      ],
      [
        'd1fd7d3cd95608c3c7b5e8234c78c1dfcfa16323dfb20fff57169b5eff3e4fe6',
        '8818dd892cf3858dfcc0e20ee70c1979f61524b8751ce888bae87ae27100b4b3',
      ],
      ['82f5800b51053c4d550b1f17ec8e2138f3bcf7f6df5e0132356132a5c27e7045'],
    ],
    joined: [
      'bca9ee981c0373f30fdc5bcf4d25064173fde9321316bed6654eec069c546d42',
      'bbee1d178a9f352ab307487eb66149617bf8ddddabb9fc435cfb39ef39b19683',
      '82f5800b51053c4d550b1f17ec8e2138f3bcf7f6df5e0132356132a5c27e7045',
    ],
    handleLengths: [11, 13, 9],
  },
  {
    category: 'hate',
    forms: [
      ['d6324be5e1592d3958a96889e8d1d4706197bf6961795656a1340d4322a6df03'],
      ['27f350122c0f40cc26174bb4320cdc2921f7f7406aef8c2c8d18fa354f53d1c8'],
    ],
    joined: [
      'd6324be5e1592d3958a96889e8d1d4706197bf6961795656a1340d4322a6df03',
      '27f350122c0f40cc26174bb4320cdc2921f7f7406aef8c2c8d18fa354f53d1c8',
    ],
    handleLengths: [10, 10],
  },
  {
    category: 'hate',
    forms: [['344d972639fb2e6654806cf694da14db5db276318df1f71f9c162fa6cb35aa16']],
    joined: ['344d972639fb2e6654806cf694da14db5db276318df1f71f9c162fa6cb35aa16'],
    handleLengths: [8],
  },
  {
    category: 'hate',
    forms: [
      [
        '8327cdd67a9d9cf18b72a566cd18a4348d058d2cf796774aadef73830fd2aca2',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        'e2a50f036c18bd20a8a23f71fdd09c13a7606a2e21501226af3192238e04d8f3',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
      [
        'f59e28f8bb6499ddf0521ed7a60aeda00957aeb7ee605caf17a216f7a9a26d08',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        'ef9ab3d75be42cffd0d76790f0936dd9bac3f6b1205107f6158ce27a6b385aca',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
      [
        '8327cdd67a9d9cf18b72a566cd18a4348d058d2cf796774aadef73830fd2aca2',
        '5730830c46f43565a31ce1c2fc15fe8901a77b8a8c8c729faccf5095af3277c1',
      ],
      [
        'e2a50f036c18bd20a8a23f71fdd09c13a7606a2e21501226af3192238e04d8f3',
        '4039dd73b3e9a8c3c9c5e27f238e62abd238c7f0bc5e230b81a96cf264317a3b',
      ],
      [
        'f59e28f8bb6499ddf0521ed7a60aeda00957aeb7ee605caf17a216f7a9a26d08',
        '5730830c46f43565a31ce1c2fc15fe8901a77b8a8c8c729faccf5095af3277c1',
      ],
      [
        'ef9ab3d75be42cffd0d76790f0936dd9bac3f6b1205107f6158ce27a6b385aca',
        '4039dd73b3e9a8c3c9c5e27f238e62abd238c7f0bc5e230b81a96cf264317a3b',
      ],
    ],
    joined: [
      '8203149ce38c9bc2e56c5529eb39d214dcccfa29bc20a810265e3d5a8f6ba77a',
      'f6c7b8121f95609b999144d70407956056ea6f7cb7c9055c03c8f3eed9b51d1f',
      'd014c06fb9719a3f1ae682a20eabf9c460e720ca9811d17f20574908ceb408ca',
      'd50c848d6b060320a34226f9e272fcc35481e91fd893f137c927ec3a36f1d151',
      '5df552cde811edbec2c041e7bf7abed9311ac56da0dd8c2b7e77593f7db6058d',
      '36471d1c2874a4ad45fef0492a798749567b21bceeb72f39821cfaa09ead6371',
      '8a15683d3fa8caa9aea18b135bb59c13dcb0452b288722ad4cdac5b95da4656a',
      '9ac5d3b740df38546b0d8f8e18cabbad8d8016fa256f428a4c50c896bdbdf59f',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '9ffe05b4553f32356d4d70f128ff0bb8c19f64275c45153ef26ed127e264a2aa',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        'cac1f1ca4833f52e3e91836faa13910713a7a40f2379b65c4f5c00b25a67bd6b',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
      [
        '9ffe05b4553f32356d4d70f128ff0bb8c19f64275c45153ef26ed127e264a2aa',
        '5730830c46f43565a31ce1c2fc15fe8901a77b8a8c8c729faccf5095af3277c1',
      ],
      [
        'cac1f1ca4833f52e3e91836faa13910713a7a40f2379b65c4f5c00b25a67bd6b',
        '4039dd73b3e9a8c3c9c5e27f238e62abd238c7f0bc5e230b81a96cf264317a3b',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '9ffe05b4553f32356d4d70f128ff0bb8c19f64275c45153ef26ed127e264a2aa',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'cac1f1ca4833f52e3e91836faa13910713a7a40f2379b65c4f5c00b25a67bd6b',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'b8da49146c7b9721c6cb9e99d8a0b996a07d12fd2f2c14044eaff471b35dd158',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '11e6532fa43c2e00656c3e0daffd29722ecfec2f220915a924a430d96d489272',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '11e6532fa43c2e00656c3e0daffd29722ecfec2f220915a924a430d96d489272',
      ],
    ],
    joined: [
      '9aa82b9f1fbfe67d9bbbdd977ac807fefbe4f8961eee396130d008bf67af26b1',
      'd31797618b4af2f870aa5f1a9bc995bd68e21330cea33c5267c9ecd06e4eee5c',
      'bded8059f56b2e0e17e13748a861d0b22d9ae5804275a96dbc753c54b18baa2c',
      '3861e28a1f5ccc0d8c737b7d5f5669926831e3e5e2b8eff7e3952ed2d0583ec0',
      '55c9adf66058516440b82d282f1ec3092cb22f870a95669e42b624b8d9f5f9d6',
      '1a01d0a17e0985a7e399bd807255f30b92678022c65a5dfa7705921c8baf1a26',
      'b387616cecd92a2970b47c178c87bb4cfb77558618c8857581509e8051b73db8',
      'c37cce062fc304c819f124c6d2d3d61f2483661a742e13c9e476f61b7e592bb5',
      '169ee1a63fcb0d9f0a795cb1ba7128898cd9d3df68bb7ffdc245ffb13c21d0a7',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'ef313faac5bff4bca92d781840f45ea20d8691b41bee580b82464d215ed788cc',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '86c2d49b26554ec7b584d3726036d0c455837e89f465168682ce8a7d8b8aa9cb',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        '71c1436b8d14428fec1d12c2d2a7d260177514fafa0969cf438ce0c79e5bd57d',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        '71c1436b8d14428fec1d12c2d2a7d260177514fafa0969cf438ce0c79e5bd57d',
      ],
      [
        '6494187cf8ccaffc87c5fa8392b7e4bd82e5026f34e4662ff66187ee88d670bc',
        'ad87d1c9ecad1a6c0e7ab32179aab7c1d2c055b978caf4c520a0bf7b1a619a35',
      ],
      [
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'ad87d1c9ecad1a6c0e7ab32179aab7c1d2c055b978caf4c520a0bf7b1a619a35',
      ],
    ],
    joined: [
      '4733e7763b1675660d314dfb7105859ba4be7e7461532f385080f39d07e68b3b',
      '2f2e2890bcad1669d0ce1d9fcec247eec2a48b3de76edc5b1af8de3b758fdcbc',
      'ee2e14336c0d92a3f374c27dee3686b7ad3076ab254c10f1514fbaa9b4d2b766',
      '93b3ad6e1380a7a79b8dfdd2dbffe50e2e99295ffbd6cb1e6457348a4392a4d0',
      '90a56cdbfdc1e4ed7b7b479d1adc86445db78fedfa79755d80ef0fde9df306bc',
      '2d3f93579feaed305189d4ed587c6af4592c0eba4f901ae8720768138e09c897',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        'd25e715a1ce00764951fcf764f3de002e766a320c4e699c78fc055d6a4dc17b0',
        '43bedf2a1d0b6ca79775b57b68b381f68b47913bd5f2c64184f834ade7f1898d',
        '0806e3c892d51a90705f8da00228d5feaa79ec485f31fbbbcb4964d23df375eb',
      ],
      [
        'd25e715a1ce00764951fcf764f3de002e766a320c4e699c78fc055d6a4dc17b0',
        'a1453f380fa9f1a08e84d4703e9c168fda1fb9a36976c41a03c8af842aa04ce5',
        'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
        '0806e3c892d51a90705f8da00228d5feaa79ec485f31fbbbcb4964d23df375eb',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        '43bedf2a1d0b6ca79775b57b68b381f68b47913bd5f2c64184f834ade7f1898d',
        '0806e3c892d51a90705f8da00228d5feaa79ec485f31fbbbcb4964d23df375eb',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        'a1453f380fa9f1a08e84d4703e9c168fda1fb9a36976c41a03c8af842aa04ce5',
        'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
        '0806e3c892d51a90705f8da00228d5feaa79ec485f31fbbbcb4964d23df375eb',
      ],
      [
        'd25e715a1ce00764951fcf764f3de002e766a320c4e699c78fc055d6a4dc17b0',
        '07ed400759a0f606a8b5bfa84712aabe7d1b1c45cb6536c8a5727446b6647b84',
        'fbdbdb9e3995a891c7fb2ba4320249e17df51e0eb907c1ec5334c6b1b2f0742b',
      ],
    ],
    joined: [
      'f795f753838fa255bce6ad327352f6bb5f3828c96d2629cba4e60e9a8ed332b9',
      '9d55ad14559c5ede72461a31d7c0c49634546042041650ad074024a297931b95',
      '99b730aa77cf77a4e0816b95fd7d6ab09331f2d234508a3cbbbf640cdc2c9096',
      '03a3e418028ed51db3c958b44a0b1f83d193a317182e4ac69fdcf016b8ec1e35',
      '2239bb0b8a2dda686fb5c746fd79ba5663bf1cf238c6d138e664a39b4ce8d8ba',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        'add4fabb5231c9cc41a31750452000472c257792d7d2ab579af02a2c1994eeed',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        '176ca0e7407715f031a0529ad1d186ef44cb6e76559aaece64cbed0191e358f7',
      ],
    ],
    joined: ['d256b037bdb91f566144579e818de51df4fbded41a4f21fb2eeb247a71286015'],
  },
  {
    category: 'hate',
    forms: [
      [
        '4dc20647b4a0252f89ac6faef6bc1651096bafe3b6160b8e175a99b1df8b3ace',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'ba8804a731f7a68bf6e4af171575ac996a1982933e8a34ed0c43df8cf035cc59',
      ],
      [
        '4dc20647b4a0252f89ac6faef6bc1651096bafe3b6160b8e175a99b1df8b3ace',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'b34e115f3a16b5bccb06d82835985d34998e3774fb27870487179e80d912c15f',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        'f49f3b8e2f439c94016950f0ad625b25ffd75a860cd507a1b3c567c070899ae6',
      ],
    ],
    joined: [
      'f93c34154334ff58a74defec5de93f3eb23091914c5c540d36e7f22c731aaae4',
      '0ae2f3719589cda54f261b878076b9f9bd5be38ecc21045452e6cb3ac9b4bf5b',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '099c4a3de20ce8c44ec660a9f779bb8d64280bc7211f3d07b5120d06dcecfda4',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        '8327cdd67a9d9cf18b72a566cd18a4348d058d2cf796774aadef73830fd2aca2',
      ],
    ],
    joined: ['debb6f446147cedfaf148bb1f7cc8a5483f2cd26cefcab0b304ec928f38640ad'],
  },
  {
    category: 'hate',
    forms: [
      [
        'e77558622638f15a336949d64361f416606e14b50281c768d8cc8b9d7a56cb0d',
        'a1f21ccdff800537c3dac5d9321c93e696f47d38505d6b8365d5303cabcb38ae',
      ],
      [
        'e955b0564f8cfff3ff440c092af872ff317034f1eaedf291cdc3d538074381fa',
        'ddb08d0527b5b6b1cedffc91955761d852bdd735c659eb2ed408d8ed833395a5',
      ],
      [
        'e77558622638f15a336949d64361f416606e14b50281c768d8cc8b9d7a56cb0d',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        'e955b0564f8cfff3ff440c092af872ff317034f1eaedf291cdc3d538074381fa',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
    ],
    joined: [
      '17803aba4d2ad81b34154c426d579f651208a89c826c270fa443cb084d5437c8',
      '6e19fcd2b48b1c397c009050978684eecf7505baa22dd0a7e279eb91e86a230f',
      '91be820913bd77644dea6f46a61525c1eb77c945e27417ceb21cc94a1688eeb8',
      'd5325e8ee82a8b4eee80e3c9f6ced88dbb10d62685e8ff624f1d757b480346b3',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '79aab9c21bd804dd18d92a677dc1b5e9f3b370b984fee302f72fbf0918155741',
        '93fa93c7103250b89be6df5f59704d238d9c98902c9acc5015f920a015ddc94f',
      ],
      [
        '97260be355e126a1d0d5045c8b96d6a80259ed70dce19cc7051d874830f09d03',
        '16b68b1e4a57ac13074432ac29588f78993465b563bc3c1fa6657752f3af3b93',
      ],
      [
        '434db3d9b64c47a0f344170c0cf4e8f61e381bbfd638e6dd340498ecf2d242e7',
        '241bb93a7b222fe6be71bdf1349f8ba4fb48951d550c10b4470058f32c266d76',
      ],
    ],
    joined: [
      'c2482205005bb44bde1b1523754a9ac2c8e439fba2116fa24d81caa026a50005',
      '2ed987a920938fbfc57c0538c9ab7e83c5fc9ac74bde8d5181eb7250bc02c9f2',
      '2a1e4c7d7c4decb9251c5277a0d2ec2d239ea96ac5ab6f10cdc52a19a2186e5a',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        'cafced969f44803831cf4ae162cb064751d99443bfef815417d726ae79d11176',
        '8ed7e3d45ad3a51156e2a2de90b79beb6ffe222b82d73c52169ae1787221f300',
      ],
      [
        '536df2280935e9cc6c5d160be166a255c684d73886223b23e6599265ba7a5436',
        '8ed7e3d45ad3a51156e2a2de90b79beb6ffe222b82d73c52169ae1787221f300',
      ],
    ],
    joined: [
      'a95d256c2ea0cdcc68f02d17f98224f7dee4a9a3d453d5a13b7ec3e8adfb5f44',
      'e7e53a611edf6863b16a2e155e235b9c7d4b5cb43c2939487fea6a5eefb9a1d4',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '5767aa5832dee84b6c7361a5e7dacb87c8c1e53e0363771c7354c7fb2ab8384a',
        'ed4ed23ecdf451a717687c8fc3184b718f31724fff20b3c86e6764f55abc2f20',
      ],
      [
        '5767aa5832dee84b6c7361a5e7dacb87c8c1e53e0363771c7354c7fb2ab8384a',
        'bfb36471bad42211caa746ea117741fe52ee0388e11dc03b52a8894ed2aac50b',
      ],
      ['891d22b1abedfec932baa97e61595fe2665c41725acd71fe713f53d99d0aaf97'],
    ],
    joined: [
      '07fc52f52a7aef7b33e4daf778765fabb77c5dc1223791a99c5f670843897e73',
      '9d09a331f4118ef87df9a41a6db5f64472a9d93c98f5ba5bb9675c75ed95e9c8',
      '891d22b1abedfec932baa97e61595fe2665c41725acd71fe713f53d99d0aaf97',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        'cd2fbf44db7968dc49e1bfe22fc5c0b43afba95092fc8edd2ec8dca2cda67f6b',
        'ed4ed23ecdf451a717687c8fc3184b718f31724fff20b3c86e6764f55abc2f20',
      ],
      [
        '00f996abdbdbbea11ebe08cfb8f51076ffe091dacb9b31bdaaf7d91dee409ade',
        'bfb36471bad42211caa746ea117741fe52ee0388e11dc03b52a8894ed2aac50b',
      ],
      [
        '96a8d57823847c43ff490e8a612d8b27a90531b46dd8718f67c78974c020662d',
        'ed4ed23ecdf451a717687c8fc3184b718f31724fff20b3c86e6764f55abc2f20',
      ],
      [
        '1239049a78ec6b32bd265482336c9814051f37ad50600f3b7dfc0093dc06be75',
        'bfb36471bad42211caa746ea117741fe52ee0388e11dc03b52a8894ed2aac50b',
      ],
      [
        'cd2fbf44db7968dc49e1bfe22fc5c0b43afba95092fc8edd2ec8dca2cda67f6b',
        'f8afacc8c9d0c40e0b8a06ede6ab1392b299ef3969804748c404694c1a6315d9',
      ],
      [
        '00f996abdbdbbea11ebe08cfb8f51076ffe091dacb9b31bdaaf7d91dee409ade',
        'ab2a32366cb6022f9a30620f91500e62aa42fce89beee59f96c481d6fbb4690c',
      ],
      [
        'a6f457dfab0c4a085396412a6f7bdf177ac6881f4653194ef18191d7436efe1c',
        '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
        '3cf4897608d8ae2d9ccd9e087be19fc7ba962b9ae38e784f1b770eea3394645f',
      ],
    ],
    joined: [
      'b598f655db6c07dc7bd6a42740da1c4a0588e6f01adcd338ce92363d26962ef2',
      '21f015372893a44eabb12d1a82793dc5d787439c5dc46c171baeb6474f240699',
      'aa5e5c9d74ce34a9d31456d4177adbfb0d63ce8208e36e0f098cf0883219567d',
      'edaff7263e0bb6680077611c904246bcb761a9c06e41425696502ba31048ae2d',
      'f4c798d4bf946efa2e3cd24a94e6e6350a92293c9f70db7118c182e2e137f1ff',
      '05e92610f5535e904b13701d5b69a221802aaef90a1c9e0fb28bcfc556891069',
      'b96fcd4aec0b5f9759ea67c8e0c03945fec99b6beba74ee2e167ac120d338459',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '96a8d57823847c43ff490e8a612d8b27a90531b46dd8718f67c78974c020662d',
        '4dd4b3a5b3b81afe5b31b73ed0b8a205dcf82f13c04a4574bc027f56055ad307',
      ],
      [
        '1239049a78ec6b32bd265482336c9814051f37ad50600f3b7dfc0093dc06be75',
        'f77be841fd149722309b4e36dd69769cffbf9e17b1dad6ea2bb4b33d955510b1',
      ],
      [
        'cd2fbf44db7968dc49e1bfe22fc5c0b43afba95092fc8edd2ec8dca2cda67f6b',
        '4dd4b3a5b3b81afe5b31b73ed0b8a205dcf82f13c04a4574bc027f56055ad307',
      ],
      [
        '00f996abdbdbbea11ebe08cfb8f51076ffe091dacb9b31bdaaf7d91dee409ade',
        'f77be841fd149722309b4e36dd69769cffbf9e17b1dad6ea2bb4b33d955510b1',
      ],
      [
        '4d7faabb081f7a6d1c4eb5d663b909b1f5adbe1c9880375c1c37857fb483d317',
        '4dd4b3a5b3b81afe5b31b73ed0b8a205dcf82f13c04a4574bc027f56055ad307',
      ],
      [
        'fb54e9062429a93785559529beda15c55f62c29be22267811c0e8346c14846d3',
        'f77be841fd149722309b4e36dd69769cffbf9e17b1dad6ea2bb4b33d955510b1',
      ],
    ],
    joined: [
      'b3d446727cc204d06efb468dd9aa2b249dbd6f3fea5ed1c99b6d7e3fcca8585e',
      'a158b865d55698c109b68ce20838457aa34c7b78989f36ab321941fa9578ff0b',
      '59b3fb276929e1f01e5c233fb7e820b0bcea81480a77394841098d5ed6a27cf3',
      '4ae29d8cb1a46c2f95d7bd96c32054abeffb438c8f4273e6bbba1eb3c23a425a',
      '038ebc474d9cc437070eb5aa8c52eafb0343c5f0cf88a499a87e1c60ae232d9a',
      '4cb557a441947050996c43416040f1736715305e84bd4bb47895d154e32a29be',
    ],
  },
  {
    category: 'hate',
    forms: [
      [
        '586acb3c6bac489308c0938f762da702573a714dfdf3a729dcb40758b4c363ae',
        '1f7be6908b217b4af27cdf058505fcf9ca92fe1ff70cda404d969767dac57483',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        '871d2260245fb2b8a5f843b89827990bf5aeaee0c50a36dc0a6020fc25c5b58a',
      ],
      [
        '586acb3c6bac489308c0938f762da702573a714dfdf3a729dcb40758b4c363ae',
        'ffb807943274ffe9ae528cd7db2047f8f24e34c8ee73315492cb927d6d700166',
        '871d2260245fb2b8a5f843b89827990bf5aeaee0c50a36dc0a6020fc25c5b58a',
      ],
      [
        '586acb3c6bac489308c0938f762da702573a714dfdf3a729dcb40758b4c363ae',
        '1f7be6908b217b4af27cdf058505fcf9ca92fe1ff70cda404d969767dac57483',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        '68cec569fd46170b46ae9fede4553c6d9406cd93d9275657b8e1c49861d62435',
      ],
      [
        '586acb3c6bac489308c0938f762da702573a714dfdf3a729dcb40758b4c363ae',
        'ffb807943274ffe9ae528cd7db2047f8f24e34c8ee73315492cb927d6d700166',
        '68cec569fd46170b46ae9fede4553c6d9406cd93d9275657b8e1c49861d62435',
      ],
    ],
    joined: [
      '5e28577046375783a17439189eca170480e85f1cfcf9a5572a2e4cc95ee1aa16',
      '1038af3e1d98bc3f06ab11e1f1ae76d19024b6bfa7258a477c9e13841b3ec6bf',
      '360a3b0aeb4bc6b1b4000a12a65c88dfa9f0d81cea5a3e59db61a83de511b893',
      '54b32c7a2ade3e7e3c4a0a2a9e02487afff73752bfbb4ab1cb77f0107a8f57cd',
    ],
  },
  {
    category: 'sexual',
    forms: [
      ['ce741fee73f964f4d36ebc1d1ead6ca7dacd444c87242703a28f998d964b0306'],
      ['51cd0c4cc268e51e565e8a2121817509f888172310dd05a2ffd6ed5b0729f5b6'],
      ['d5def803faf565e70690bbc805610df10d40df8824216a039ad70df482ac7929'],
      ['d43cc07ae12bc6d91c78c8cb9720cc9456bec5e2b384c2b83a70c0bf9ab5fc34'],
      ['393fa07ae607b1bacfe723b698c50f9ee3e897eb12d8aff4888e77115fcfd71a'],
      ['2add5dd0e18acc825db671c1642eced117562ac07aa27ba19e01dbb33de333f7'],
    ],
    joined: [
      'ce741fee73f964f4d36ebc1d1ead6ca7dacd444c87242703a28f998d964b0306',
      '51cd0c4cc268e51e565e8a2121817509f888172310dd05a2ffd6ed5b0729f5b6',
      'd5def803faf565e70690bbc805610df10d40df8824216a039ad70df482ac7929',
      'd43cc07ae12bc6d91c78c8cb9720cc9456bec5e2b384c2b83a70c0bf9ab5fc34',
      '393fa07ae607b1bacfe723b698c50f9ee3e897eb12d8aff4888e77115fcfd71a',
      '2add5dd0e18acc825db671c1642eced117562ac07aa27ba19e01dbb33de333f7',
    ],
    handleLengths: [6, 6, 9, 7, 8, 8],
  },
  {
    category: 'sexual',
    forms: [
      ['ca8ccf2990b2ebc7910a80304c811e9b52622d4828666cbf4fd18b8ca3f8f713'],
      ['4c029faa7da056a4c01968447034703064e76e4c8e645a2fa79f615ad98b614d'],
    ],
    joined: [
      'ca8ccf2990b2ebc7910a80304c811e9b52622d4828666cbf4fd18b8ca3f8f713',
      '4c029faa7da056a4c01968447034703064e76e4c8e645a2fa79f615ad98b614d',
    ],
    handleLengths: [6, 9],
  },
  {
    category: 'sexual',
    forms: [
      ['7afe2b1c5aab15b62a5045382490b0d2d86d54c884d57a93e57def636db7455c'],
      ['3a92b26f6d0a4fd6aafd1445af9df8f5ebe6f9035d5e52bb62ca07c3309a3181'],
      ['6b9a38d4f10c081f54f6efed686bed1a8830cd606fa270a3b15dacb3871791b3'],
    ],
    joined: [
      '7afe2b1c5aab15b62a5045382490b0d2d86d54c884d57a93e57def636db7455c',
      '3a92b26f6d0a4fd6aafd1445af9df8f5ebe6f9035d5e52bb62ca07c3309a3181',
      '6b9a38d4f10c081f54f6efed686bed1a8830cd606fa270a3b15dacb3871791b3',
    ],
    handleLengths: [6, 8, 10],
  },
  {
    category: 'sexual',
    forms: [['d23aafd334f92a8d1a28c94b29e2626b18ac1fcffa9c4405b3224fac98a8ba6d']],
    joined: ['d23aafd334f92a8d1a28c94b29e2626b18ac1fcffa9c4405b3224fac98a8ba6d'],
    handleLengths: [7],
  },
  {
    category: 'sexual',
    forms: [['f00122f031b1bd91b7a33b02bd69af698bd9709f7677d53cbf8c3930599ec66d']],
    joined: ['f00122f031b1bd91b7a33b02bd69af698bd9709f7677d53cbf8c3930599ec66d'],
    handleLengths: [8],
  },
  {
    category: 'sexual',
    forms: [
      ['af83ae81832416b80018e9d6d8a047a8c59e1a972a5d996fc3da679378d834fd'],
      ['390ac424555ea5b12a891cdd383923a2c39980d78ba9f7a4f9e5d1e4dc379376'],
      ['d18b9c15f02ac3aa32560f57c2bfe363b7609a6a97d561905e2cce32f89789fa'],
      ['3b2d6f76326e82b80ff1e0866fcc5c623c989d50bf4e6fc2c4145e13a4607b24'],
      ['1653675e2686e1b518dfd06688aad6a42e8e1b462f6969c2bbc2db64e23ccb24'],
    ],
    joined: [
      'af83ae81832416b80018e9d6d8a047a8c59e1a972a5d996fc3da679378d834fd',
      '390ac424555ea5b12a891cdd383923a2c39980d78ba9f7a4f9e5d1e4dc379376',
      'd18b9c15f02ac3aa32560f57c2bfe363b7609a6a97d561905e2cce32f89789fa',
      '3b2d6f76326e82b80ff1e0866fcc5c623c989d50bf4e6fc2c4145e13a4607b24',
      '1653675e2686e1b518dfd06688aad6a42e8e1b462f6969c2bbc2db64e23ccb24',
    ],
    handleLengths: [6, 7, 8, 10, 8],
  },
  {
    category: 'sexual',
    forms: [['b9e3e42ac0af865e3991255f6fce5bcec5a7774893aa3e5199336b88d29e5584']],
    joined: ['b9e3e42ac0af865e3991255f6fce5bcec5a7774893aa3e5199336b88d29e5584'],
    handleLengths: [7],
  },
  {
    category: 'sexual',
    forms: [
      ['59e11dcffe7ad54cf629a803f156104a104d0ede1d64676fdb2319b1e66382e1'],
      ['c2d9e6975560decc8ce067cbff3bd1e9440611a77bb8ee91a7aa96e8bc5c5b40'],
      ['1e49ba521bde132bfd7c99ae80cd49c108644c942789fe26bfbca3bbdc387e50'],
      ['a12194126391b58619afee129b22964b81a3fce90b098fa98a70410130d57e68'],
      ['ce42dae6cb7ee816e84014ad2ce65ed4c6ab40f1c692112662a4df9497e953ca'],
      ['e2fd800497093d83402e6f45b769b4237e0e847566b76a2d8734295c5d55d981'],
    ],
    joined: [
      '59e11dcffe7ad54cf629a803f156104a104d0ede1d64676fdb2319b1e66382e1',
      'c2d9e6975560decc8ce067cbff3bd1e9440611a77bb8ee91a7aa96e8bc5c5b40',
      '1e49ba521bde132bfd7c99ae80cd49c108644c942789fe26bfbca3bbdc387e50',
      'a12194126391b58619afee129b22964b81a3fce90b098fa98a70410130d57e68',
      'ce42dae6cb7ee816e84014ad2ce65ed4c6ab40f1c692112662a4df9497e953ca',
      'e2fd800497093d83402e6f45b769b4237e0e847566b76a2d8734295c5d55d981',
    ],
    handleLengths: [7, 10, 10, 8, 10, 9],
  },
  {
    category: 'sexual',
    forms: [['b5e3f4f3082f5159dd4faad92f98ad2d1dd0cbe53399103c70c9f7b3a3c410aa']],
    joined: ['b5e3f4f3082f5159dd4faad92f98ad2d1dd0cbe53399103c70c9f7b3a3c410aa'],
    handleLengths: [6],
  },
  {
    category: 'sexual',
    forms: [['90561fb07b11e4230ce996d27e20a75b4676b41df005d6ecc10f3ffc58a4aae5']],
    joined: ['90561fb07b11e4230ce996d27e20a75b4676b41df005d6ecc10f3ffc58a4aae5'],
    handleLengths: [8],
  },
  {
    category: 'sexual',
    forms: [
      ['ffc5e5151b2ab5f26267b239c8bb7e99a7bab13cbcd76e8aa4f3350e86108fc5'],
      ['1bba3ac99cf96d026d2646b58c0f7578d2a734219c4d915fbf6f407b825df8d1'],
      ['1cafd6f5f8120149a4aae145619d38fc3a8f3aaa802e50ab8e0fe6f597fe86db'],
    ],
    joined: [
      'ffc5e5151b2ab5f26267b239c8bb7e99a7bab13cbcd76e8aa4f3350e86108fc5',
      '1bba3ac99cf96d026d2646b58c0f7578d2a734219c4d915fbf6f407b825df8d1',
      '1cafd6f5f8120149a4aae145619d38fc3a8f3aaa802e50ab8e0fe6f597fe86db',
    ],
    handleLengths: [7, 10, 10],
  },
  {
    category: 'sexual',
    forms: [
      ['b9eb40f876f3d569bb0ea0480516d7d77cf897243bdd7925ae161382df4cc311'],
      ['b5f59c7cf224397db1451ea1697cce52a587a7317c0e937486bc62a58186f511'],
      ['bd1e61ea7aaf8a7c7dc78fe3b79e0da0dce8a2e707609130585d2b2a995e8907'],
    ],
    joined: [
      'b9eb40f876f3d569bb0ea0480516d7d77cf897243bdd7925ae161382df4cc311',
      'b5f59c7cf224397db1451ea1697cce52a587a7317c0e937486bc62a58186f511',
      'bd1e61ea7aaf8a7c7dc78fe3b79e0da0dce8a2e707609130585d2b2a995e8907',
    ],
    handleLengths: [6, 7, 8],
  },
  {
    category: 'sexual',
    forms: [
      ['a4d62f7474297de20bf26b7170f2eed0a66777d786e943c3f13f23d9d29da4d6'],
      ['cbd7be8035c77c796a2b6fd5e732ee13094b4f76607756df8798ac78223cd2ec'],
      ['1b580a3d507dde6cf87778ac3ae63aceec4ac88a380d8913ede54912256085dd'],
      ['276800bfb9bc665ae07467f84e358d3a5c198674e7cff67112e41a448c599b17'],
    ],
    joined: [
      'a4d62f7474297de20bf26b7170f2eed0a66777d786e943c3f13f23d9d29da4d6',
      'cbd7be8035c77c796a2b6fd5e732ee13094b4f76607756df8798ac78223cd2ec',
      '1b580a3d507dde6cf87778ac3ae63aceec4ac88a380d8913ede54912256085dd',
      '276800bfb9bc665ae07467f84e358d3a5c198674e7cff67112e41a448c599b17',
    ],
    handleLengths: [6, 6, 9, 9],
  },
  {
    category: 'sexual',
    forms: [
      ['0033728f0fbc83a0f0226d91bb063540d6d0158c0bbfa1620ae5b95b10f82932'],
      ['8c5c04391361cbf4afd74c5ed8101ea4af881c4ee3b3df1d5b3716a19b1a834d'],
    ],
    joined: [
      '0033728f0fbc83a0f0226d91bb063540d6d0158c0bbfa1620ae5b95b10f82932',
      '8c5c04391361cbf4afd74c5ed8101ea4af881c4ee3b3df1d5b3716a19b1a834d',
    ],
  },
  {
    category: 'sexual',
    forms: [
      [
        '47229efc8721837e0f1b8b6f211b8ccb425d4ed9903c373e86418e1575c96810',
        '6577be77529947bf04c41fca275a6405b66698659cbb7889c0b5f97ecded21b0',
      ],
      [
        '47229efc8721837e0f1b8b6f211b8ccb425d4ed9903c373e86418e1575c96810',
        'd92f4cf1e2d7e8129d7536dda13e3b1898da728ee64e2f9566cb7c86619bbda5',
      ],
      [
        '6c192fb7b0bbaca9c5c60072ad1a971a6bf083a0c4dcde68ceb40aa7088d141d',
        '6577be77529947bf04c41fca275a6405b66698659cbb7889c0b5f97ecded21b0',
      ],
      [
        '2744ccd10c7533bd736ad890f9dd5cab2adb27b07d500b9493f29cdc420cb2e0',
        '47229efc8721837e0f1b8b6f211b8ccb425d4ed9903c373e86418e1575c96810',
        '6577be77529947bf04c41fca275a6405b66698659cbb7889c0b5f97ecded21b0',
      ],
      [
        '47229efc8721837e0f1b8b6f211b8ccb425d4ed9903c373e86418e1575c96810',
        '6187eb884a2243dbed3a648d69e5a1a538be022abc7d72d596fc0b1024fa3dab',
        'cc2760d2584959230374fc3f29234d01e5dc76f78a62a2ea416995b821a7b9a1',
      ],
      [
        '27ce1d1bf4270020e1799f12e647f5cbabda2b9eafd7202c43012a539986916b',
        '6577be77529947bf04c41fca275a6405b66698659cbb7889c0b5f97ecded21b0',
      ],
    ],
    joined: [
      '48a427d31feaa7be3e814b43cc5c2d387cbf750da0fc4c26bccfffd0bdfd5ae7',
      '6816be1d86e78caeda5dba63a59d3c61fad90dcfb15f5c7abaa5ba97808a0fdb',
      'f381e08921bb3dcd9978bd3df1ecb8bee3e52e9d24153405a861baaf058a16c9',
      '12d37041b46f2661e175ee8304e2e2d884f697f8dffdd8c60817a3b7def14803',
      '3814f085d9fbede3b467855f57abe886328fedfcb1f011646c32c9f8c0ffdf9a',
      '68800b999d198ebf4c77a83bcd1311270056421b93379c3fd8e9e2a5bf65f247',
    ],
  },
  {
    category: 'sexual',
    forms: [
      [
        'b9dfa8d8d942eb8ea2b78c1aa3e5d85ae70697dbc76b0811abbc317d098f5fbb',
        '4b152f7c6c1c13dee1e634bc339d8b790cfe60a1c6d65508f01cb0906727a60c',
        '470adaa55fab37a1a00db983fcc022a1dbb13fc7361937f36cdc5f14de19f6ce',
      ],
      [
        'b9dfa8d8d942eb8ea2b78c1aa3e5d85ae70697dbc76b0811abbc317d098f5fbb',
        'c7aa8d3434d0371929cfc15587b15da79df50269b2a195fe82c26037067b3f5e',
        '4a0916ee9ae469d6b2dcf196b89fecf88664eb65dd9fa5e69c7c1f14f8f85f8c',
      ],
      [
        'b9dfa8d8d942eb8ea2b78c1aa3e5d85ae70697dbc76b0811abbc317d098f5fbb',
        '4a0916ee9ae469d6b2dcf196b89fecf88664eb65dd9fa5e69c7c1f14f8f85f8c',
      ],
      [
        '9d19b88231649e5a73193ce2c6a7070a59546653375a52bb018d07d0cbb63abb',
        '9390298f3fb0c5b160498935d79cb139aef28e1c47358b4bbba61862b9c26e59',
        '4b152f7c6c1c13dee1e634bc339d8b790cfe60a1c6d65508f01cb0906727a60c',
        '470adaa55fab37a1a00db983fcc022a1dbb13fc7361937f36cdc5f14de19f6ce',
      ],
      [
        '9d19b88231649e5a73193ce2c6a7070a59546653375a52bb018d07d0cbb63abb',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        'c7aa8d3434d0371929cfc15587b15da79df50269b2a195fe82c26037067b3f5e',
        '4a0916ee9ae469d6b2dcf196b89fecf88664eb65dd9fa5e69c7c1f14f8f85f8c',
      ],
      [
        '9d19b88231649e5a73193ce2c6a7070a59546653375a52bb018d07d0cbb63abb',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        '4b82f17aab9a5129bc54e1f5509ae0d1808ba74bac255ac54bf883daf94e1236',
      ],
      [
        '9d19b88231649e5a73193ce2c6a7070a59546653375a52bb018d07d0cbb63abb',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        'c7aa8d3434d0371929cfc15587b15da79df50269b2a195fe82c26037067b3f5e',
        'f61f5c5e22749aeba2bd920352dbd4c9f63e0ebaed6df623b09c836ffcbec2eb',
      ],
    ],
    joined: [
      '166124c362a22fb2352c62f7e78207acbb1117821b614ea9f62c18b59a3dc3bf',
      'edb04f7b3cb6e55c86a914493169a819e3c32d37a4a78a95f14bcc9ca5a73995',
      'ad02db0e6fabeb2fab2dce9805d66793dac87ed711d7c3847b56742e0beb9870',
      '4487790d4a225db2ad0a341e81f10d1eca4d605113783e9981ac930275fad2ed',
      'c4e3bb00fefea0fbdfd48be1b45e44aae924a6158f20ac8419045f8b2651a7f9',
      'a0f2f2cce066926ff1e350a774f14da24d894623f83d3ea453ecf28239c63d6e',
      '622ee9b1b988f1a5450bf17eabceb264a0b411438cf63e3cb9742ea9d10b3c92',
    ],
  },
  {
    category: 'sexual',
    forms: [
      [
        '9a3c00b0c0b9b201711e7fec1f72b1a9952474572908dc32e4bfae49c5091abe',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'f61f5c5e22749aeba2bd920352dbd4c9f63e0ebaed6df623b09c836ffcbec2eb',
      ],
      [
        '9a3c00b0c0b9b201711e7fec1f72b1a9952474572908dc32e4bfae49c5091abe',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        '9c976eb6c570eefca4c621b0e5517d1c354a7168c33f0dc230df6c09d5cce993',
        'f61f5c5e22749aeba2bd920352dbd4c9f63e0ebaed6df623b09c836ffcbec2eb',
      ],
      [
        '5fd872d6385bec2c74048be5d6dee51c3036d02c403d73bba2b8128bd525d246',
        '3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18',
        'faec19c1278b308a886fae4a2f00dd411c38fda363a1d5a2f95fb3b720257336',
        'f61f5c5e22749aeba2bd920352dbd4c9f63e0ebaed6df623b09c836ffcbec2eb',
      ],
    ],
    joined: [
      '58062a73d04bdd953dd16dc04cffd355ee45370138ce2fb49fee12dc6932cf1c',
      '10ffc07d8dbe92398b4a38cf2f0ed9db1490bf80294ab171bb59d42312047cb1',
      '5663823b1b0032fe812d1ca4977b75ab507d180f73af6012b372d80e153132eb',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '3b02a908fd5743c0e868675bb6ae77d2a62b3b5f7637413238e2a1e0e94b6a53',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '3b02a908fd5743c0e868675bb6ae77d2a62b3b5f7637413238e2a1e0e94b6a53',
        '3b8efab1dfd112995877c42ee1c18b19605426b1260f226cd3d99fe8da89fcb0',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '3b02a908fd5743c0e868675bb6ae77d2a62b3b5f7637413238e2a1e0e94b6a53',
        '522a45442726c9f9ddc6cdd60b3b627c4a34268a2a30910475a7347cfe32900d',
      ],
      [
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '89aa0538f35b19fa0deb3e396a30157df2b081ee725d4a4b4d23a632f14dab9c',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        'e69fe0f5750c896ea401054e53cf071878bd3630e2a5bd86d6031e063dcc90e2',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '5d9c970dcd517291d13e5010a4d44864daeaa5efdb17919615d3d1a5036ed9e5',
        '289c90decf40c8ec15f72f6080f2a4e7cd11d4128530dd5d290fc06ebadba620',
        'a3ffd5aa99e04b2ddd1e54e9cb9e84ab3a7aac81ed34cf7bbc238b1763e4883b',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '78f5a9ec7df94d89df3826eaa716ed7d3fd4a05aa8c5ae4f7259aad90ddb8e42',
        '84a47f61dd341ce731390149a904abcd58a6044263071abf44a475cf91563029',
        '3b8efab1dfd112995877c42ee1c18b19605426b1260f226cd3d99fe8da89fcb0',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        'c9a1ec2ba4db34f41c87d617bddc820be4fd620fdf3e94b1b38bbd03325a89de',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        'f2c7b92934edfb022ede4ffea932475683f3ad4137caf9c279e71a6917f8fea0',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        'cb176df9a4d03d62233d3ac4e85eb57fba55eb9505e7406b027a278aca80b3ca',
      ],
    ],
    joined: [
      '7e7121ddb9904fe4e7e8c9218235460216ee05e6f39846aab590072513207362',
      'e929bf1f18ba7b1b480be3455e8d26439350f0588899113f1fc1c0b9e1105e25',
      '897e63d051d78b3bf37f24bc82f0b9aac2dd26c1e175d9e2a59efb458cf646ba',
      '9d9f830a4dc551c48bde7d4643b5315b4929506effe4fef1d49f26a65e685221',
      '426f47e3c88f3473e633c6488d50ec3b5e35d28aace616d8db7e6ba5f664cd96',
      'a3e42a3604f2a7c6dffa54713770eae4a8901147eefe7ee15f13a00340abb4a6',
      'b267569fcf352988ab5ef213f010780b0c69910270b6e39124d71371883f40e5',
      '0a1a9937ce5ddd6903b7e3ba16d5ea9beb0d499dfefa48b8d60c2cbe960a78de',
      '0370364a09df04bf9d21d5ad88abff9f883a475b4f24adb2b8b51f5dea7fbc9a',
      '745f5fe3cb422440b7845fc0eb1f6d7a935d8f6482156c6e1bd522bcbaf24882',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '1f1ce7930c0ea3ca081ae2302fcb1eac030deb576d0cf17ab58af200a218f6ba',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '1f1ce7930c0ea3ca081ae2302fcb1eac030deb576d0cf17ab58af200a218f6ba',
        '3b8efab1dfd112995877c42ee1c18b19605426b1260f226cd3d99fe8da89fcb0',
      ],
      [
        '6f0c7c12839ef59945c16b81c42ff1250ac6334f3e17dd9531fd57eaa216f978',
        '1f1ce7930c0ea3ca081ae2302fcb1eac030deb576d0cf17ab58af200a218f6ba',
        '522a45442726c9f9ddc6cdd60b3b627c4a34268a2a30910475a7347cfe32900d',
      ],
      [
        '2d6c9a90dd38f6852515274cde41a8cd8e7e1a7a053835334ec7e29f61b918dd',
        '76ac4ac67d50e9e8480fe22d5975dc18b06e9d4be6fb82fe50efd8478b2e4778',
      ],
      [
        'ffb807943274ffe9ae528cd7db2047f8f24e34c8ee73315492cb927d6d700166',
        'f0e948db590cf453844da435e2d8326484f50a19c4ab6a3f3d03714728b30eae',
        '4675c7735379ac68bf7fd6da83e6fed83e467927dc79ec7eb03a34aa6df4761b',
      ],
      [
        '1f562a4785d1104244f191edf1b71305c5557c40f801def79c7c2831db382d3b',
        'f0e948db590cf453844da435e2d8326484f50a19c4ab6a3f3d03714728b30eae',
        '4675c7735379ac68bf7fd6da83e6fed83e467927dc79ec7eb03a34aa6df4761b',
      ],
    ],
    joined: [
      '6d82d6ac5d8abcf941a628c97d2318f3bef365cefaf9f95362148f6fcececee9',
      'dea8655710b85908ba99220b214af35989296ad0697645134404a8b408d1a080',
      'b9376414988d90b8e3538dfcba2e176b52fb02dc0449d221975c981f5efd1247',
      '3f5484ea99c505d8e7a811a012f93807c119f5743de1650bbeb7c0e28cbe3ab5',
      '80241359632992667db868dbedd16649da63810cce18ebe11671bfeb730fc703',
      'fc621dd3c84c7e125ee6ef6ed66d3f4a5cb5bcb8f71ca0e27b43a649920e3f27',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'c6b312868e056101fe03dcb5c90a3b317993bf99ee23384719be0016c4acd149',
        '3598ce6f965b2481fe26316c06b30950c46ac7f8e7229f104aa78f579997668d',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'fd243a7f2942477b61f1c6cb93cec494214735b1c076a8bb80ee18a94bf4ccba',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '5304378d007825ccb10495d27c4dbddbcc77040639b83e69bda4ebea0703cfbd',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '1c30cf596d956996202feca2d6094d29d9e9a0703508606c285078b08d4ec43e',
        '3598ce6f965b2481fe26316c06b30950c46ac7f8e7229f104aa78f579997668d',
      ],
      [
        'df0724e3b90f5fc5dc684b0837a53ad575851014008a5db28f4c8f5cb19baa50',
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'cb176df9a4d03d62233d3ac4e85eb57fba55eb9505e7406b027a278aca80b3ca',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'db99e90ce2a451f1fb7c18529ae3b05697f16a83b8b81c8a2ca50ddcbcb358f7',
        '3598ce6f965b2481fe26316c06b30950c46ac7f8e7229f104aa78f579997668d',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        '9ac3dd0f4dac35664e68afb69369c82e67a7de5c31e8ecd075ce849cf1066a83',
        'aa58b21b01d6b8a99c1a5856962dbac36c758a79dc0a77c2e013ce2c39ecdc8a',
        'c8e60cf43a41d52b44a9542efe6904060a6bde3db1df5057241308af071fd08f',
      ],
      [
        'cec396807d2e3d95e775d26aa38c2d17209911c6952212211ed4f66009d81846',
        '840a8dcfeae95966a870b0b5257997ce94cbc19dd979409d1671d2e93a9e0de6',
        '55247229bf301d86d9186a6e87cf57f689b54be5fb797cf88901e139c57e7225',
      ],
      [
        'ad9a67fefa847de87753df6794a0ae466431e76ad1fb4db58fbbe836d1dde0e7',
        'cec396807d2e3d95e775d26aa38c2d17209911c6952212211ed4f66009d81846',
        '3598ce6f965b2481fe26316c06b30950c46ac7f8e7229f104aa78f579997668d',
      ],
    ],
    joined: [
      '44786748e14192fa8597fdc78e9d6471f8597c5c34a5fa431440891b9ee75cf7',
      'aa813a97241c89bb85df34da6a1137b98a5d7426ebbccab60f1d845b4ddd6e48',
      'ed6b4a920fb009cb1e15f68124ccbb7f102b25c0f57df02f4fcae27618d006bd',
      'ce2a45ceb06c754d323f77cda3a30332765211382035977da33a034a03e0ce29',
      'b0d47e3f3ab6bec075e5462aefe72663af954455e32bc7f2e563e5b9349c9ebd',
      '67e5091a1d522533cd165cae651d71d5e98ddc1280849af15042e119d74976cc',
      '2721527c7153a535f0df89e2ed003cabd9c99f935779c91e0c888c98d76ce6ed',
      'f21c8f3665de339cbc568033989e9c3724848ce4b156a4eb297abf2c9bbc7b91',
      '91c5cf2a0c98f9d7607238c78ceca296424a9002f8439e18ffbbef53e95c653a',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        'ffb807943274ffe9ae528cd7db2047f8f24e34c8ee73315492cb927d6d700166',
        '871d2260245fb2b8a5f843b89827990bf5aeaee0c50a36dc0a6020fc25c5b58a',
      ],
      [
        '1f562a4785d1104244f191edf1b71305c5557c40f801def79c7c2831db382d3b',
        '871d2260245fb2b8a5f843b89827990bf5aeaee0c50a36dc0a6020fc25c5b58a',
      ],
    ],
    joined: [
      'cbee66581852603adbdb99c58b852a78bc513be6817e5ff2a1f921589bd4b66b',
      '0edf8611171aadd6d8a0c68ef3e097d8bf561f7289ac88eb38ed386eadbba915',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'a3791eb5ab50dbdaa2967e40cd6eb0a8e286c0ca55abf1647f59b79c3a2c0822',
        '3fb6f6b9de1d92a9d99c6e4aa12ef6e5fa8f54f149e8654e6f5f7fea9e68f6ea',
      ],
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'a3791eb5ab50dbdaa2967e40cd6eb0a8e286c0ca55abf1647f59b79c3a2c0822',
        '523701a35a5c2f5660d0bf616387b5c782638a3ac9151fbf9a65d777b9637f95',
      ],
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'a3791eb5ab50dbdaa2967e40cd6eb0a8e286c0ca55abf1647f59b79c3a2c0822',
        'c905e73dd427119b25bce70bf85c3457880f6d9b2fa67a82fdd520ac869945df',
      ],
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'a3791eb5ab50dbdaa2967e40cd6eb0a8e286c0ca55abf1647f59b79c3a2c0822',
        '1f543edc6213f515e6b57beb4bd5153fcf201cb69dcbba36cd2c6ebd8d5b4dd6',
      ],
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'a3791eb5ab50dbdaa2967e40cd6eb0a8e286c0ca55abf1647f59b79c3a2c0822',
        '03777379d87d499438014990aea588db3ca0ceef98dbf5f1c74dfe97568fc573',
      ],
      [
        '7766859651a77c5166f5c19d1f18390fe64fef30d0b7c59972eddd2ea93e9271',
        'f4bf9f7fcbedaba0392f108c59d8f4a38b3838efb64877380171b54475c2ade8',
        '76678c8094b9912f7d7544f86c2f3028865942920fbb5b53fea885a6295b21a1',
      ],
    ],
    joined: [
      '8adef54f022a2366c123b63fbd6454457d4fdcffdcd345293346452c8c524d7b',
      '398044fd38e55126184f62a1a086cf00540206685aff8408e6979ce5d2900cad',
      'b652d59e38ceee96cff772461c807260920abc9973b5f553626e6b9cea4edb9f',
      '79a55b32fd66ca40710935c3e9391ec9c6107e0a116adcf348a8b25e34142aab',
      '244bf01cf5622baaf7f6bf1e14af5def92a443c13c84e04f559973520e2bb339',
      '0939a30da8a1f14a1c8ff81fec91a010f6fee04fb4bdf8217bd33ac90f3e4c1a',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        'd60d5020ab2bedb1c61857b7800ae93671d4e9c0b788a68a1306016751a0c923',
        '1f7be6908b217b4af27cdf058505fcf9ca92fe1ff70cda404d969767dac57483',
        'c57b7501cd843672550c711a346dd93e9bdc2c97a640874d54b4c9cf4b12ee81',
        '68cec569fd46170b46ae9fede4553c6d9406cd93d9275657b8e1c49861d62435',
      ],
      [
        'd60d5020ab2bedb1c61857b7800ae93671d4e9c0b788a68a1306016751a0c923',
        '9fd21576df074d5b7354844a7ce8fcb306058d563dc126b8b056774e62cfa29f',
        '959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578',
        '68cec569fd46170b46ae9fede4553c6d9406cd93d9275657b8e1c49861d62435',
      ],
      [
        'd60d5020ab2bedb1c61857b7800ae93671d4e9c0b788a68a1306016751a0c923',
        'ffb807943274ffe9ae528cd7db2047f8f24e34c8ee73315492cb927d6d700166',
        '68cec569fd46170b46ae9fede4553c6d9406cd93d9275657b8e1c49861d62435',
      ],
    ],
    joined: [
      'a596cb07689969409c8e64f4aa9b1e4ef0d034317e6728e895bdc46793935e30',
      'ce1b20ad0a4a621d4d4acc3b404eeb3ede53cf277a7dae729f30f7d33020a8f6',
      '4d977ec79d998f60af8c90228bab5775b57c585b9e50aa924db4125ff6ea6d49',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '6a26e2b7a5361812d59abe94ccb471f9f3a8877c730f10a8e8d49df28d27a43e',
        '23f2f997f50293ec6d5f75b7cdd7c8c1823028c6660b4976d3a4db1255cfc427',
        '3b8efab1dfd112995877c42ee1c18b19605426b1260f226cd3d99fe8da89fcb0',
        'faf4cec4bc508b56f1caec91198c3272a833310be34f481f21f471b40bf23b43',
      ],
      [
        '6a26e2b7a5361812d59abe94ccb471f9f3a8877c730f10a8e8d49df28d27a43e',
        '23f2f997f50293ec6d5f75b7cdd7c8c1823028c6660b4976d3a4db1255cfc427',
        '522a45442726c9f9ddc6cdd60b3b627c4a34268a2a30910475a7347cfe32900d',
        'faf4cec4bc508b56f1caec91198c3272a833310be34f481f21f471b40bf23b43',
      ],
    ],
    joined: [
      '964bce79786f946655f871447c0a5da5066ee39a3b537ceeae5fe196d26ecc45',
      'ac76c8096af3578f431ae30c9530835b8c781a124ff846b0e488106742adf6d2',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '7b647ad3351583187ba385a63f9db305ab9fb8454d8fda032d67719026406a3f',
        '65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2',
        '04e458069cf61b70edcd182c3a57ea9ba83a686c913a7f2dc3493738eb9a7284',
      ],
      [
        '93b0951a15358de5e6bd3416111c193d76e43348f2d8c84e9a04e5f24e73af1f',
        '559eb181d7a3ec94502c7030166e29e3e2fbce691679d41cd71c3b9ba3072ba9',
      ],
    ],
    joined: [
      '1c092f2f5019f2bc6f2a99a29ce830708db788e36384e107606af31c560ff55c',
      'f063b58df46eeeff799a99948291283097330cfa6c848c05637545977fe18202',
    ],
  },
  {
    category: 'profanity',
    forms: [
      ['6ac3c336e4094835293a3fed8a4b5fedde1b5e2626d9838fed50693bba00af0e'],
      ['31506a8448a761a448a08aa69d9116ea8a6cb1c6b3f4244b3043051f69c9cc3c'],
      ['0c64f3ba82e066a20f43719767ccd03d36fb2e2d96756e647abf7dbfac74168a'],
      ['b690cdbe59f14b3be083db03237e04051abd85c4ffe35180723e9cb45cd3a519'],
      ['bb61ef40814ce34c1edf0edb609854be9793198a8f60b67d9fb26643c32281d3'],
      ['2f5f6ce5ae30b54aa5d7ced1ba566982bab34ba2814a51ce1865d2c2d8815cd4'],
      [
        '6ac3c336e4094835293a3fed8a4b5fedde1b5e2626d9838fed50693bba00af0e',
        'bb0347a468d97e98a9c00e37cebec1ab930f6f1221cae0f1fbb92b07e1900ba2',
      ],
      ['01cccf00c85370364854bc6155432a5f2aee570e80313fb85c1fc5f70b7aa22c'],
      ['bb0689e399cca9d90283112d73aa6c899953c4c3cbd39a3c087b63de39f304aa'],
    ],
    joined: [
      '6ac3c336e4094835293a3fed8a4b5fedde1b5e2626d9838fed50693bba00af0e',
      '31506a8448a761a448a08aa69d9116ea8a6cb1c6b3f4244b3043051f69c9cc3c',
      '0c64f3ba82e066a20f43719767ccd03d36fb2e2d96756e647abf7dbfac74168a',
      'b690cdbe59f14b3be083db03237e04051abd85c4ffe35180723e9cb45cd3a519',
      'bb61ef40814ce34c1edf0edb609854be9793198a8f60b67d9fb26643c32281d3',
      '2f5f6ce5ae30b54aa5d7ced1ba566982bab34ba2814a51ce1865d2c2d8815cd4',
      '6161b0a284159565a0f7d5df2dd2698b5f87906cd91ff5322caf179b451f5a41',
      '01cccf00c85370364854bc6155432a5f2aee570e80313fb85c1fc5f70b7aa22c',
      'bb0689e399cca9d90283112d73aa6c899953c4c3cbd39a3c087b63de39f304aa',
    ],
  },
  {
    category: 'profanity',
    forms: [
      ['85fc17f7069acd39a5c636cd0a6530651096128da447959f5e250824857dc559'],
      ['f79637f1501ad98c7a4b56522bb64d454823d87fc777e207265bdd01c1ec29fb'],
      ['a6c5e5d0d107619936b64314e380a873e56ba1b565b23d9381f942bf68f20206'],
      ['bcd1642bca163da3c9d2903abf3663a79fe3295dd31a8e5b12705c6bd62611db'],
      [
        '34235a2c502e3919d3f00af5dabb87cb58aef4566b10631f2a5db94950ebffbd',
        '28391d3bc64ec15cbb090426b04aa6b7649c3cc85f11230bb0105e02d15e3624',
        '85fc17f7069acd39a5c636cd0a6530651096128da447959f5e250824857dc559',
      ],
    ],
    joined: [
      '85fc17f7069acd39a5c636cd0a6530651096128da447959f5e250824857dc559',
      'f79637f1501ad98c7a4b56522bb64d454823d87fc777e207265bdd01c1ec29fb',
      'a6c5e5d0d107619936b64314e380a873e56ba1b565b23d9381f942bf68f20206',
      'bcd1642bca163da3c9d2903abf3663a79fe3295dd31a8e5b12705c6bd62611db',
      '2a1cd11faff6791c208dda823f1a68a2dc3a999b52e5cf66166fab217047878a',
    ],
  },
  {
    category: 'profanity',
    forms: [['1837bc2c546d46c705204cf9f857b90b1dbffd2a7988451670119945ba39a10b']],
    joined: ['1837bc2c546d46c705204cf9f857b90b1dbffd2a7988451670119945ba39a10b'],
  },
  {
    category: 'profanity',
    forms: [['1ce99fbe332c5003c8e224e668daeaab4b3d935388846a32701f70870bd6b9a1']],
    joined: ['1ce99fbe332c5003c8e224e668daeaab4b3d935388846a32701f70870bd6b9a1'],
  },
  {
    category: 'profanity',
    forms: [['31c97373f1315ba23a74dfd61d73b026693ff9026941ac1e406afac48c144e73']],
    joined: ['31c97373f1315ba23a74dfd61d73b026693ff9026941ac1e406afac48c144e73'],
  },
  {
    category: 'insult',
    forms: [
      ['d75a838dc758ba17f28bd8dbac605cb70c35465263d5733164521de2f7ef7926'],
      ['262f86db0ac788ad9c3c7cd7aa6b1df5388cfe9df8407b8aa5c4c06d67ecf493'],
      [
        '98aa6675482552881925fe70d82559692d811b3bcd33f53b9a702c24d5322696',
        '28391d3bc64ec15cbb090426b04aa6b7649c3cc85f11230bb0105e02d15e3624',
        'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
        'd75a838dc758ba17f28bd8dbac605cb70c35465263d5733164521de2f7ef7926',
      ],
    ],
    joined: [
      'd75a838dc758ba17f28bd8dbac605cb70c35465263d5733164521de2f7ef7926',
      '262f86db0ac788ad9c3c7cd7aa6b1df5388cfe9df8407b8aa5c4c06d67ecf493',
      '4578be3e143eb7b9bfd7604d8fa37a96ed266b159e2a540866d86d3adbea51eb',
    ],
    handleLengths: [5, 6, 11],
  },
  {
    category: 'insult',
    forms: [
      ['b262cd219f7d412268d5db14d28e382bfbdd93efa4ac40a9a5127782a3048fcc'],
      ['958ce5c321d2549986d4bee8c5ac187783128950aa14fb0f2a8e5eb5e5187a48'],
    ],
    joined: [
      'b262cd219f7d412268d5db14d28e382bfbdd93efa4ac40a9a5127782a3048fcc',
      '958ce5c321d2549986d4bee8c5ac187783128950aa14fb0f2a8e5eb5e5187a48',
    ],
    handleLengths: [6, 8],
  },
  {
    category: 'insult',
    forms: [
      ['cd1ca27ff0af1627c541290f2a9f2a6cbaec7ede0189baed009071565b02bc99'],
      ['c2a8ff1ee25ad2ab43ae96fa24a77852653f9cd2c796bd967b074be74622329c'],
    ],
    joined: [
      'cd1ca27ff0af1627c541290f2a9f2a6cbaec7ede0189baed009071565b02bc99',
      'c2a8ff1ee25ad2ab43ae96fa24a77852653f9cd2c796bd967b074be74622329c',
    ],
    handleLengths: [6, 6],
  },
  {
    category: 'insult',
    forms: [['e512a05583448f44790783f986b1f36925c8cfc42338ca0e1caa637755bd15ae']],
    joined: ['e512a05583448f44790783f986b1f36925c8cfc42338ca0e1caa637755bd15ae'],
  },
  {
    category: 'insult',
    forms: [['566f532d486c947709d3d0e6b7575af8380248db66dada211d58eb00ad585297']],
    joined: ['566f532d486c947709d3d0e6b7575af8380248db66dada211d58eb00ad585297'],
  },
  {
    category: 'insult',
    forms: [['9ae315a94e428a7ee3b5e48adae6541965d93b86acf10ffa1c45b93b6fe577b4']],
    joined: ['9ae315a94e428a7ee3b5e48adae6541965d93b86acf10ffa1c45b93b6fe577b4'],
    handleLengths: [5],
  },
  {
    category: 'insult',
    forms: [['c2c3b68b48832afd9a4dbdd474c1b6c81c8baecdb71446f9947dac72dd0fe93d']],
    joined: ['c2c3b68b48832afd9a4dbdd474c1b6c81c8baecdb71446f9947dac72dd0fe93d'],
  },
  {
    category: 'insult',
    forms: [['bdb1cc258d6976aafd3a0c3399dfff42a486e63a6948d8bc2e10e7c36fab7611']],
    joined: ['bdb1cc258d6976aafd3a0c3399dfff42a486e63a6948d8bc2e10e7c36fab7611'],
    handleLengths: [6],
  },
  {
    category: 'insult',
    forms: [['dd92623b0a4b255f87cc4aaee7990ee182d91db49189df6229ce65b5e9d960da']],
    joined: ['dd92623b0a4b255f87cc4aaee7990ee182d91db49189df6229ce65b5e9d960da'],
  },
  {
    category: 'insult',
    forms: [['06a1d8bf7fc210de23d9540ab35744ae9db310afa0afbabe9529333e175a850f']],
    joined: ['06a1d8bf7fc210de23d9540ab35744ae9db310afa0afbabe9529333e175a850f'],
    handleLengths: [8],
  },
  {
    category: 'insult',
    forms: [
      ['3314b0999a53aafeaaf0c0881eb2032a08c6dedcf9924c7a3da3cb1465ffac41'],
      ['cd3b6010f4c837658f754bab36552f05b10a9074c997378e87f8364d49366cf6'],
    ],
    joined: [
      '3314b0999a53aafeaaf0c0881eb2032a08c6dedcf9924c7a3da3cb1465ffac41',
      'cd3b6010f4c837658f754bab36552f05b10a9074c997378e87f8364d49366cf6',
    ],
    handleLengths: [9, 7],
  },
  {
    category: 'insult',
    forms: [['7c4a5c242b72a23d999bb2801c6544a368f49a3ab869ef578e171079b44a9ad8']],
    joined: ['7c4a5c242b72a23d999bb2801c6544a368f49a3ab869ef578e171079b44a9ad8'],
    handleLengths: [10],
  },
  {
    category: 'hate',
    forms: [
      ['362234c02fd606c43f7d5411590962016ec17372cd17c089bc85d8aeade6bb50'],
      ['b1106bd2a8594910c2e8e1c5b0e8cc948694f0fdc5235bfbbc41f5ec3e04d25e'],
    ],
    joined: [
      '362234c02fd606c43f7d5411590962016ec17372cd17c089bc85d8aeade6bb50',
      'b1106bd2a8594910c2e8e1c5b0e8cc948694f0fdc5235bfbbc41f5ec3e04d25e',
    ],
  },
  {
    category: 'hate',
    forms: [
      ['63bd9333b1a0b11da8d0b206c4b86cd2a5be63fb5e7b59cc5ac7131f3a257489'],
      ['9915ba2d822280f22c283df4e76584a40e0119fc58f73c5f84d4fdb04d04fa6f'],
    ],
    joined: [
      '63bd9333b1a0b11da8d0b206c4b86cd2a5be63fb5e7b59cc5ac7131f3a257489',
      '9915ba2d822280f22c283df4e76584a40e0119fc58f73c5f84d4fdb04d04fa6f',
    ],
  },
  {
    category: 'hate',
    forms: [['886d51e97ad7931d0d2af8439ca6d9e4887e3c2b469ed247cbd68ceb3649ccde']],
    joined: ['886d51e97ad7931d0d2af8439ca6d9e4887e3c2b469ed247cbd68ceb3649ccde'],
  },
  {
    category: 'hate',
    forms: [
      ['b27c1d7f1e7ff7b34e25ac2db5dc5f2fd75b6f0dfa83622e15122a3d78b24b11'],
      ['76b30a2ce85f13c1a38343979a83db153f6a777fb4d9250889aeb0eaa4ce973b'],
    ],
    joined: [
      'b27c1d7f1e7ff7b34e25ac2db5dc5f2fd75b6f0dfa83622e15122a3d78b24b11',
      '76b30a2ce85f13c1a38343979a83db153f6a777fb4d9250889aeb0eaa4ce973b',
    ],
    handleLengths: [5, 7],
  },
  {
    category: 'hate',
    forms: [
      ['158869a97379229b7681efae9d7f9c9214134e836d649ba53477c0c111414d59'],
      ['bd331fb1d24298f52943034a243a341877957b895f4372b11babb87262904ed6'],
    ],
    joined: [
      '158869a97379229b7681efae9d7f9c9214134e836d649ba53477c0c111414d59',
      'bd331fb1d24298f52943034a243a341877957b895f4372b11babb87262904ed6',
    ],
  },
  {
    category: 'hate',
    forms: [['f9d0d9b18ae9033a5ea36df19bf279b059e887a9ae785db81117bceaecc95933']],
    joined: ['f9d0d9b18ae9033a5ea36df19bf279b059e887a9ae785db81117bceaecc95933'],
  },
  {
    category: 'hate',
    forms: [
      [
        '018fa96a44715c90bf93be148069cb28dd45d398f2cc75aa1565311f6e55d174',
        '07d715edb696fb5f628f7298e5d7217ed4d2bdfc5347a1c55fee30832267f21d',
      ],
      [
        '018fa96a44715c90bf93be148069cb28dd45d398f2cc75aa1565311f6e55d174',
        '470664bd59f587f32e6d933f058464084d1810ee2b3a81b0d4d59d6dd9623da2',
      ],
    ],
    joined: [
      '4250c0f1a20027a0a1b05d4557326b2c13dd71b9eac43faeecfd66438220bec0',
      '7c13d0e6498cedbb2f34b87c7cdbc6804398002b0896b29107257b7dba71f39e',
    ],
  },
  {
    category: 'sexual',
    forms: [
      ['f01abade17b3337e1bf386075c8bd46c34884867b218aac8841eaff8010d12c1'],
      ['25a16f0118b22fd6e7783b8b3f006942a684490c930e017a7552d205f3543d7e'],
    ],
    joined: [
      'f01abade17b3337e1bf386075c8bd46c34884867b218aac8841eaff8010d12c1',
      '25a16f0118b22fd6e7783b8b3f006942a684490c930e017a7552d205f3543d7e',
    ],
  },
  {
    category: 'sexual',
    forms: [
      ['665cb762e3bc03d078dea6bd624f49ac355ed3389d977f6e320792111961421d'],
      [
        '7cf6b0597fe4e3cb355932640c14cb6819d5359ac113af58d0b365c7a112fd31',
        '5e8c9902207afaeb7120430c585a445f21e92932081d64bc99f80e4925bcb002',
      ],
    ],
    joined: [
      '665cb762e3bc03d078dea6bd624f49ac355ed3389d977f6e320792111961421d',
      '665cb762e3bc03d078dea6bd624f49ac355ed3389d977f6e320792111961421d',
    ],
    handleLengths: [7, 7],
  },
  {
    category: 'sexual',
    forms: [['4140197ec7959b1c0674de1ee3c6d3f542c371276e2518427e0ad89e5c30f804']],
    joined: ['4140197ec7959b1c0674de1ee3c6d3f542c371276e2518427e0ad89e5c30f804'],
  },
  {
    category: 'sexual',
    forms: [
      [
        'cb835c490922ac919ccb1f8a82dacda2341aa01a016fb9fca13b164047b1af1f',
        '28391d3bc64ec15cbb090426b04aa6b7649c3cc85f11230bb0105e02d15e3624',
      ],
      [
        'ffe04d700ee503c58711d3bcaf3a7f684ecbaf48a32963a254c5bc9d643e7731',
        '28391d3bc64ec15cbb090426b04aa6b7649c3cc85f11230bb0105e02d15e3624',
      ],
    ],
    joined: [
      '0a4e67dab7c09602fcb7c1d4e49532b2196a594e5a267ff93144d7b4630d5978',
      '9c6d02766db099ba8aee459d72dd900b5035c057f2f43333b3ee20672f1b5232',
    ],
  },
  {
    category: 'sexual',
    forms: [
      [
        '954bafccc8afa13db7e106a919051fc24727aeb4dfb11f5dbceda1d64bcc117c',
        '038468518ad8122e13112743f890c7ba96ac5665b71de548eceb23e9ef237805',
        'ad505b0be8a49b89273e307106fa42133cbd804456724c5e7635bd953215d92a',
      ],
      [
        '954bafccc8afa13db7e106a919051fc24727aeb4dfb11f5dbceda1d64bcc117c',
        '038468518ad8122e13112743f890c7ba96ac5665b71de548eceb23e9ef237805',
        '796e43a5a8cdb73b92b5f59eb50610cea3efa8ce229cd7f0557983091b2b4552',
      ],
    ],
    joined: [
      '65584fdb05d4d70c798c34c7810e360526acaa89fc24616db99de9e1c3fa72e6',
      '9b28f9431a9b1d196332443fbb8ba1da991945c0fb4461e5434422ffeb9b6a9b',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        '4377915d527ef6f5ce21765c121505dd3e72f3885163df80008a40835dfe3315',
        'd00d825bba6ba94de153ffc5fa1e9bbd5b9e1afcc1e6aa161c9e8e954f378fdf',
      ],
      ['db775d1df73f2886f1bc2efb3573dff3ea0ed075aa18974cbbc361d941bd8cd0'],
    ],
    joined: [
      '7265d7f970ab526a77f431c1415d6ad4d701842b3c5a69a7faf3c951b7472a36',
      'db775d1df73f2886f1bc2efb3573dff3ea0ed075aa18974cbbc361d941bd8cd0',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        'de7d1b721a1e0632b7cf04edf5032c8ecffa9f9a08492152b926f1a5a7e765d7',
        '3eb3d9f76f61d6bf96bb3838f466ceea62270f1c0d722e78b4643c49e98c0052',
        '4377915d527ef6f5ce21765c121505dd3e72f3885163df80008a40835dfe3315',
        'bb0347a468d97e98a9c00e37cebec1ab930f6f1221cae0f1fbb92b07e1900ba2',
      ],
      [
        'de7d1b721a1e0632b7cf04edf5032c8ecffa9f9a08492152b926f1a5a7e765d7',
        'acac86c0e609ca906f632b0e2dacccb2b77d22b0621f20ebece1a4835b93f6f0',
        '4377915d527ef6f5ce21765c121505dd3e72f3885163df80008a40835dfe3315',
        'bb0347a468d97e98a9c00e37cebec1ab930f6f1221cae0f1fbb92b07e1900ba2',
      ],
      [
        'a0fb903525dc10dccaa4bd72bed4fe5b24ae8346b8a7343edce84172feb7085a',
        '4377915d527ef6f5ce21765c121505dd3e72f3885163df80008a40835dfe3315',
        'bb0347a468d97e98a9c00e37cebec1ab930f6f1221cae0f1fbb92b07e1900ba2',
      ],
      [
        'a898df22bfc74a1ae298c73211ab3b319e5b8da7543d6cd002a8dc4f8723be43',
        'c44d8605913ba4addb9f522e639f33275bbafe254411afd3add58386d439d607',
        '663ea1bfffe5038f3f0cf667f14c4257eff52d77ce7f2a218f72e9286616ea39',
        '4377915d527ef6f5ce21765c121505dd3e72f3885163df80008a40835dfe3315',
        'bb0347a468d97e98a9c00e37cebec1ab930f6f1221cae0f1fbb92b07e1900ba2',
      ],
    ],
    joined: [
      '209ee5c3d506d34632350c4774619dedb7601f2ad19220e326f3224cc5a8bf2e',
      'd517051ddc52db8f43ad6caf256eb601f853faade36f4e508e1828a9669f4c1b',
      'd517051ddc52db8f43ad6caf256eb601f853faade36f4e508e1828a9669f4c1b',
      'd2bda3c8d3c8e3ab44ce799517d2c1e8c17bbe9ef6699db3ca84aa619ab18059',
    ],
  },
  {
    category: 'violence',
    forms: [
      [
        'a6795d042134720097a4037c2964a6be5715dd80e65cb7122ad724186f718d57',
        '8a2496b950a93110c9af3bee5ee9e600a578574b09d0ceb7104745db0c22e0dd',
      ],
    ],
    joined: ['f9f28846f495daef43d0925a5012603b86f8db43259e88e4639f294804ff8bd1'],
  },
];

/** Palavras e frases inocentes, legíveis (palavras comuns), que nunca batem. */
export const FILTER_EXCEPTIONS: readonly string[] = ['Ponta Porã', 'Cunha Porã', 'fagotes'];
