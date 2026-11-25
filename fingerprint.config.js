/**
 * O fingerprint (o runtime dos EAS Updates) sem a `version` do app (seção 39.9 de
 * docs/arquitetura-api.md): a versão sobe a cada envio às lojas e, sozinha, não muda
 * o nativo. Este valor troca o padrão do @expo/fingerprint em vez de somar a ele
 * (o `...config` do `normalizeOptionsAsync`): por isso o padrão vem escrito de novo.
 * Um erro ao carregar este arquivo, ou um nome de chave errado, é ignorado em
 * silêncio e a versão volta ao fingerprint: o teste do apple-account trava o conteúdo.
 * @type {import('expo/fingerprint').Config}
 */
module.exports = {
  sourceSkips: ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
};
