// Synthesize preserved official/lock/final-image observations, without suppressions.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const evidence = path.resolve('docs/evidence')
const manifest = await json(path.join(evidence, 'P6E-final-runtime-manifest.json'))
const audit = await json(path.join(evidence, 'P6E-final-security-audit.json'))
assert.equal(audit.source, manifest.source)
assert.equal(audit.result, 'SCANNED_WITH_FINDINGS_PRESERVED')
assert.equal(audit.images.length, 6)
const dependencies = await json(path.join(evidence, 'P6E-final-dependency-recheck.json'))
const musl = await json(path.join(evidence, 'P6E-final-musl-source.json'))
assert.equal(musl.result, 'COLLECTED')
assert.equal(musl.patch.bothBranchChecksumsMatch, true)
const alignment = []
for (const [file, expected] of Object.entries(dependencies.dependencies)) {
  const actual = createHash('sha256')
    .update(await readFile(path.join(manifest.sourceExport, file)))
    .digest('hex')
  assert.equal(actual, expected, `The final source dependency input changed after audit: ${file}`)
  alignment.push({ file, sha256: actual, matchesFinalSource: true })
}
const lock = await json(path.join(manifest.sourceExport, 'package-lock.json'))
const nodeForge = await json('node_modules/node-forge/package.json')
const forgeRegistry = await json(path.join(evidence, 'P6E-final-node-forge-pinned-registry.json'))
const forgeLatest = await json(path.join(evidence, 'P6E-final-node-forge-registry.json'))
assert.equal(nodeForge.version, '1.4.1')
assert.equal(lock.packages['node_modules/node-forge'].version, nodeForge.version)
assert.equal(lock.packages['node_modules/node-forge'].integrity, forgeRegistry.dist.integrity)
const deepmerge = await json(path.join(evidence, 'P6E-final-deepmerge-advisory.json'))
const go = await json(path.join(evidence, 'P6E-final-go-openpgp-advisory.json'))
assert.equal(audit.sourceChecks.scannerExit, 0)
assert.deepEqual(audit.sourceChecks.importedOpenpgp, [])
const affected = (roles) =>
  audit.images
    .filter((image) => roles.includes(image.role))
    .map(({ role, imageId, source }) => ({ role, imageId, source }))
const report = {
  date: new Date().toISOString(),
  source: manifest.source,
  schema: manifest.schema,
  scope:
    'Engineering disposition only; no user production-risk acceptance or production authorization inferred',
  dependencyInputAlignment: alignment,
  rootNpm: dependencies.audits.root,
  adminNpm: dependencies.audits.admin,
  nodeForge: {
    version: nodeForge.version,
    lockMatchesOfficialRegistryIntegrity: true,
    gitHead: forgeRegistry.gitHead,
    latestObserved: forgeLatest.version,
    latestChangelog: 'P6E-final-node-forge-1.4.2-changelog.txt',
    latestScope:
      '1.4.2 restores pem.decode Buffer compatibility; the final source intentionally retains the audited 1.4.1 security fix. Review a separate compatible update with its own tests.',
    status: 'P6D_COMPATIBLE_FIX_PRESERVED',
  },
  risks: [
    {
      id: 'SEC-01',
      advisory: 'CVE-2026-107891',
      affected: affected(['worker', 'gateway', 'frontend', 'static']),
      version: 'Alpine 3.24.3 musl 1.2.6-r3',
      observedScoutFix: '1.2.6-r6',
      officialBranchFix: '3.24=1.2.6-r3; edge/master=1.2.6-r6',
      officialSameSecurityPatchSha512: musl.patch.sha512,
      officialPatchBothBranchesMatch: true,
      disposition: 'DISTRIBUTION_BACKPORT_CONFIRMED_SCOUT_FINDING_PRESERVED',
      productionBlockerFromThisFindingAlone: false,
      scopeLimit:
        'Only the recorded Alpine3.24 exact images; no assertion about other musl issues or future branches',
      mitigation:
        'No mixed repositories or unknown binary patching; final images checked via installed APK database; unchanged nonroot/readonly isolation',
      review:
        'Every image/base/Alpine branch change and before each release; escalate if distribution package or patch evidence changes',
    },
    {
      id: 'SEC-02',
      advisory: deepmerge.ghsa_id,
      affected: affected(['worker']),
      dependency: 'deepmerge@4.3.1',
      rootBuildChainAuditEntries: 7,
      independentAdvisories: 1,
      severity: deepmerge.severity,
      officialPatchedVersion: deepmerge.vulnerabilities[0].first_patched_version,
      disposition: 'UNFIXED_LOW_BUILD_DEPENDENCY_LIMITED_ATTACK_SURFACE',
      productionBlockerFromThisFindingAlone: false,
      scopeLimit: 'No claim of fix; formal release risk acknowledgement still required',
      mitigation:
        'Fixed reviewed Nuxt code/lock, validated content-only inputs, no arbitrary config/scripts, offline nonroot Worker without credentials/DB/DockerSocket and with resource limits',
      review:
        'Every release and immediately when a compatible upstream patch or builder-input change is available',
    },
    {
      id: 'SEC-03',
      advisory: go.id,
      affected: affected(['api', 'maintenance']),
      dependency: 'golang.org/x/crypto@v0.58.0',
      vulnerablePackage: 'golang.org/x/crypto/openpgp and subpackages',
      officialPatchedVersion: null,
      disposition:
        'REQUIRED_MODULE_PRESENT_VULNERABLE_PACKAGE_NOT_IMPORTED_IN_FINAL_LINUX_ENTRYPOINTS',
      productionBlockerFromThisFindingAlone: false,
      sourceExit: audit.sourceChecks.scannerExit,
      importedCrypto: audit.sourceChecks.importedCrypto,
      importedOpenpgp: audit.sourceChecks.importedOpenpgp,
      binaryScannerExits: audit.binaries.map(({ role, scannerExit }) => ({ role, scannerExit })),
      mitigation:
        'Keep Argon2id/blake2b; do not add deprecated openpgp; preserve stripped-binary module-level findings, use exact Linux source reachability and actual imports',
      review:
        'Every module/entrypoint/build-tag/toolchain change; block newly introduced vulnerable OpenPGP use',
    },
  ],
  rawEvidence: [
    'P6E-final-security-audit.json',
    'P6E-final-dependency-recheck.json',
    'P6E-final-musl-source.json',
    'P6E-final-alpine-3.24-secdb.json',
    'P6E-final-deepmerge-advisory.json',
    'P6E-final-go-openpgp-advisory.json',
    'P6E-final-node-forge-pinned-registry.json',
    'P6E-final-forge-source.json',
  ],
  operationalPending: [
    'Offsite destination/account or offline medium',
    'Encryption/signing key custodian and offline recovery drill',
    'RPO/RTO and retention acceptance',
    'Capacity/backup alert channel and named primary/backup operator',
    'Independent production authorization and final content scope',
  ],
  result: 'REVIEWED_WITH_RESIDUAL_FINDINGS_NOT_ZERO_RISK',
}
await writeFile(
  path.join(evidence, 'P6E-final-risk-disposition.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log('Reviewed final-image residual findings; official raw alerts remain preserved')
