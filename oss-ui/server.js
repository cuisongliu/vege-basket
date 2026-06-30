const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const OSS = require("ali-oss");
const yaml = require("js-yaml");

const rootDir = __dirname;
const port = Number(process.env.PORT || process.env.OSS_UI_PORT || 4173);
const rulesFile = normalizeString(process.env.TRIAL_COMBO_PACKAGE_RULES_FILE);
const downloadExpireSeconds = Number(process.env.OSS_UI_DOWNLOAD_EXPIRE_SECONDS || 30 * 60);
const configuredPassword = normalizeString(process.env.OSS_UI_PASSWORD);
const passwordHash = process.env.OSS_UI_PASSWORD_SHA256 || (configuredPassword ? sha256(configuredPassword) : "");
const sessionSecret = process.env.OSS_UI_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const middlewareRoot = normalizePrefix(process.env.OSS_UI_MIDDLEWARE_ROOT);
const baseObjectTemplate = normalizeString(process.env.OSS_UI_BASE_OBJECT_TEMPLATE);
const baseListPrefixTemplate = normalizeString(process.env.OSS_UI_BASE_LIST_PREFIX_TEMPLATE);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function signSession(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function sessionCookieValue() {
  const value = "oss-ui";
  return `${value}.${signSession(value)}`;
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function isAuthenticated(req) {
  const token = parseCookies(req).oss_ui_session || "";
  const [value, signature] = token.split(".");
  return value === "oss-ui" && signature === signSession(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizePrefix(value) {
  const normalized = normalizeString(value);
  return normalized && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function renderTemplate(template, values) {
  return normalizeString(template).replace(/\{(\w+)\}/g, (_, key) => {
    return values[key] == null ? "" : String(values[key]);
  });
}

function normalizeVersion(value) {
  const version = normalizeString(value).toLowerCase();
  if (!version || version === "无") return version;
  return version.startsWith("v") ? version : `v${version}`;
}

function normalizeList(values) {
  const seen = new Set();
  const list = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
  }
  return list;
}

function loadRules() {
  if (!rulesFile) {
    throw new Error("TRIAL_COMBO_PACKAGE_RULES_FILE must be set");
  }
  const file = fs.readFileSync(rulesFile, "utf8");
  const parsed = yaml.load(file);
  const rawRules = parsed && parsed.rules ? parsed.rules : {};
  const rules = [];

  for (const [rawKey, rawRule] of Object.entries(rawRules)) {
    const id = normalizeString(rawKey).toLowerCase();
    if (!id) continue;
    const rule = rawRule || {};
    const fileNameFormats = normalizeList([rule.file_name_format, ...(rule.file_name_formats || [])]);
    const ciFileNameFormats = normalizeList(rule.ci_file_name_formats);
    rules.push({
      id,
      name: normalizeString(rule.name) || id,
      releaseRoots: normalizeList(rule.release_roots),
      flatFileRoots: normalizeList(rule.flat_file_roots),
      fileNameFormats,
      ciFileNameFormats,
      flatFileNamePrefix: normalizeString(rule.flat_file_name_prefix),
      flatFileNameSuffix: normalizeString(rule.flat_file_name_suffix),
      flatFileNameSuffixes: normalizeList(rule.flat_file_name_suffixes),
      mode: rule.flat_file_roots && rule.release_roots ? "mixed" : rule.flat_file_roots ? "flat" : "release",
    });
  }

  return rules.sort((a, b) => a.id.localeCompare(b.id));
}

function publicRules() {
  return loadRules().map((rule) => ({
    id: rule.id,
    name: rule.name,
    category: ruleCategory(rule),
    mode: rule.mode,
    releaseRoots: rule.releaseRoots,
    flatFileRoots: rule.flatFileRoots,
    fileNameFormats: rule.fileNameFormats,
    ciFileNameFormats: rule.ciFileNameFormats,
  }));
}

function ruleCategory(rule) {
  const roots = [...rule.releaseRoots, ...rule.flatFileRoots];
  if (middlewareRoot && roots.some((root) => root.startsWith(middlewareRoot))) {
    return "middleware";
  }
  return "apps";
}

function ossClient() {
  const endpoint = normalizeString(process.env.OSS_ENDPOINT);
  const accessKeyId = normalizeString(process.env.OSS_ACCESS_KEY_ID);
  const accessKeySecret = normalizeString(process.env.OSS_ACCESS_KEY_SECRET);
  const bucket = normalizeString(process.env.OSS_BUCKET);
  if (!endpoint || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error("OSS_ENDPOINT, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET must be set");
  }
  return new OSS({
    endpoint,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: endpoint.startsWith("https://"),
  });
}

async function listAllObjects(client, prefix) {
  const objects = [];
  let marker = undefined;
  do {
    const result = await client.list({ prefix, marker, "max-keys": 1000 });
    for (const object of result.objects || []) {
      if (object.name && !object.name.endsWith("/")) {
        objects.push(object);
      }
    }
    marker = result.nextMarker;
  } while (marker);
  return objects;
}

async function listCommonPrefixes(client, prefix) {
  const prefixes = [];
  let marker = undefined;
  do {
    const result = await client.list({ prefix, delimiter: "/", marker, "max-keys": 1000 });
    for (const item of result.prefixes || []) {
      prefixes.push(item);
    }
    marker = result.nextMarker;
  } while (marker);
  return prefixes;
}

function splitVersionPart(part) {
  const match = String(part).match(/^([a-zA-Z]+)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]) };
}

function compareVersionParts(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
    return Math.sign(leftNumber - rightNumber);
  }

  const leftSplit = splitVersionPart(left);
  const rightSplit = splitVersionPart(right);
  if (leftSplit && rightSplit && leftSplit.prefix === rightSplit.prefix) {
    return Math.sign(leftSplit.number - rightSplit.number);
  }

  return left.localeCompare(right);
}

function compareVersions(left, right) {
  const leftTokens = normalizeVersion(left).replace(/^v/, "").split(/[._-]/);
  const rightTokens = normalizeVersion(right).replace(/^v/, "").split(/[._-]/);
  const max = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < max; index++) {
    let leftToken = leftTokens[index] || "";
    let rightToken = rightTokens[index] || "";
    if (!leftToken && rightToken) {
      if (splitVersionPart(rightToken)) return 1;
      leftToken = "0";
    }
    if (leftToken && !rightToken) {
      if (splitVersionPart(leftToken)) return -1;
      rightToken = "0";
    }
    const compared = compareVersionParts(leftToken, rightToken);
    if (compared !== 0) return compared;
  }
  return 0;
}

function formatFileName(format, version, arch) {
  return normalizeString(format).replace("%s", version).replace("%s", arch);
}

function candidateFileNames(formats, version, arch) {
  const names = new Set();
  for (const format of formats) {
    const name = formatFileName(format, version, arch);
    if (!name) continue;
    names.add(name);
    if (name.endsWith(".tar")) {
      names.add(`${name}.gz`);
    }
  }
  return [...names];
}

function signedDownloadUrl(client, objectKey) {
  try {
    return client.signatureUrl(objectKey, { expires: downloadExpireSeconds, method: "GET" });
  } catch (error) {
    if (!String(error.message || error).includes("endpoint is IP")) {
      throw error;
    }
    const expires = Math.floor(Date.now() / 1000) + downloadExpireSeconds;
    const endpoint = String(client.options.endpoint).replace(/\/+$/, "");
    const bucket = client.options.bucket;
    return `${endpoint}/${bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}?Expires=${expires}`;
  }
}

function objectToLink(client, name, version, object) {
  return {
    name,
    version,
    objectKey: object.name,
    size: object.size,
    lastModified: object.lastModified,
    downloadUrl: signedDownloadUrl(client, object.name),
  };
}

function isArchiveObjectKey(key) {
  return /\.tar(\.gz)?$/.test(key) && !key.endsWith(".md5");
}

function proMiddlewareNameFromId(packageId) {
  if (!packageId.startsWith("pro:")) return "";
  return normalizeString(packageId.slice("pro:".length));
}

async function publicProMiddlewareRules(client, excludedNames = new Set()) {
  if (!middlewareRoot) return [];
  const prefixes = await listCommonPrefixes(client, middlewareRoot);
  return prefixes.map((prefix) => {
    const name = prefix.slice(middlewareRoot.length).replace(/\/$/, "");
    return {
      id: `pro:${name}`,
      name,
      category: "middleware",
      mode: "pro-middleware",
      releaseRoots: [prefix],
      flatFileRoots: [],
      fileNameFormats: [],
      ciFileNameFormats: [],
    };
  }).filter((item) => item.name && !excludedNames.has(item.name)).sort((a, b) => a.name.localeCompare(b.name));
}

function extractProMiddlewareVersion(name, fileName) {
  const suffixMatch = fileName.match(/-(amd64|arm64)\.tar(?:\.gz)?$/);
  if (!suffixMatch) return "";
  let version = fileName.slice(0, suffixMatch.index);
  const prefixes = [`${name}-`, `${name}`];
  for (const prefix of prefixes) {
    if (version.startsWith(prefix)) {
      version = version.slice(prefix.length);
      break;
    }
  }
  version = version.replace(/^-+/, "");
  return version || "latest";
}

function proMiddlewareHashFromObject(root, objectKey) {
  const rest = objectKey.slice(root.length);
  const parts = rest.split("/");
  return parts.length > 1 ? normalizeString(parts[0]) : "";
}

async function listProMiddlewareReleaseVersions(client, name, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  if (!middlewareRoot) return [];
  const root = `${middlewareRoot}${name}/`;
  const objects = await listAllObjects(client, root);
  const versions = new Map();

  for (const object of objects) {
    const fileName = object.name.slice(root.length);
    if (!fileName || fileName.includes("/") || !isArchiveObjectKey(fileName) || !fileName.includes(`-${arch}.tar`)) continue;
    const version = extractProMiddlewareVersion(name, fileName);
    const current = versions.get(version);
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(version, { version, object });
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }));
}

async function buildProMiddlewarePackage(client, name, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const versions = await listProMiddlewareReleaseVersions(client, name, query);
  const requestedVersion = normalizeString(query.get("releaseVersion"));
  const version = requestedVersion || (versions[0] && versions[0].version) || "";
  if (!middlewareRoot) throw new Error("OSS_UI_MIDDLEWARE_ROOT must be set");
  const root = `${middlewareRoot}${name}/`;
  const objects = await listAllObjects(client, root);
  const matched = objects.filter((object) => {
    const fileName = object.name.slice(root.length);
    return fileName &&
      !fileName.includes("/") &&
      isArchiveObjectKey(fileName) &&
      fileName.includes(`-${arch}.tar`) &&
      extractProMiddlewareVersion(name, fileName) === version;
  });

  return {
    title: name,
    type: "pro middleware",
    meta: [
      { label: "目录", value: root },
      { label: "正式版本", value: version || "未找到" },
      { label: "下载有效期", value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions: versions,
    links: matched.map((object) => objectToLink(client, name, version, object)),
  };
}

async function listProMiddlewareCiVersions(client, name, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  if (!middlewareRoot) return [];
  const root = `${middlewareRoot}${name}/`;
  const objects = await listAllObjects(client, root);
  const versions = new Map();

  for (const object of objects) {
    const hash = proMiddlewareHashFromObject(root, object.name);
    if (!hash) continue;
    const fileName = object.name.slice(`${root}${hash}/`.length);
    if (!fileName || fileName.includes("/") || !isArchiveObjectKey(fileName) || !fileName.includes(`-${arch}.tar`)) continue;
    const current = versions.get(hash);
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(hash, { hash, object });
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      hash: item.hash,
      label: formatCiLabel({ hash: item.hash, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }));
}

async function buildProMiddlewareCiPackage(client, name, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const versions = await listProMiddlewareCiVersions(client, name, query);
  const hash = normalizeString(query.get("ciVersion")) || (versions[0] && versions[0].hash) || "";
  if (!middlewareRoot) throw new Error("OSS_UI_MIDDLEWARE_ROOT must be set");
  const root = `${middlewareRoot}${name}/`;
  const objects = hash ? await listAllObjects(client, `${root}${hash}/`) : [];
  const matched = objects.filter((object) => {
    const fileName = object.name.slice(`${root}${hash}/`.length);
    return fileName && !fileName.includes("/") && isArchiveObjectKey(fileName) && fileName.includes(`-${arch}.tar`);
  });
  const selected = versions.find((item) => item.hash === hash);

  return {
    title: name,
    type: "pro middleware ci",
    meta: [
      { label: "目录", value: root },
      { label: "测试版本", value: selected ? selected.label : "未找到" },
      { label: "下载有效期", value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    ciVersions: versions,
    links: matched.map((object) => objectToLink(client, name, selected ? selected.label : hash, object)),
  };
}

function versionLabel(item) {
  return item.lastModified ? `${normalizeVersion(item.version)} · ${formatTime(item.lastModified)}` : normalizeVersion(item.version);
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "unknown time";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function objectTime(object) {
  const value = object.lastModified || object.lastModifiedTime || object.LastModified;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

async function buildBasePackage(client, query) {
  const deployType = normalizeString(query.get("deployType") || "pro").toLowerCase();
  if (!baseObjectTemplate) throw new Error("OSS_UI_BASE_OBJECT_TEMPLATE must be set");
  const versions = await listBaseVersions(client, deployType, query);
  const requestedVersion = normalizeVersion(query.get("releaseVersion") || query.get("version") || "");
  const version = requestedVersion || (versions[0] && versions[0].version) || "";
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  if (!version || !arch || !deployType) throw new Error("deployType, version and arch are required");

  const packageNames = deployType === "pro" ? ["sealos-pro", "sealos-commercial"] : [`sealos-${deployType}`];
  const links = [];
  for (const packageName of packageNames) {
    for (const fileName of candidateFileNames([`${packageName}-%s-%s.tar`], version, arch)) {
      const key = renderTemplate(baseObjectTemplate, { deployType, version, fileName, arch, packageName });
      try {
        const head = await client.head(key);
        links.push(objectToLink(client, packageName, version, {
          name: key,
          size: Number(head.res.headers["content-length"]),
          lastModified: head.res.headers["last-modified"],
        }));
        break;
      } catch (error) {
        if (error && error.code !== "NoSuchKey" && error.status !== 404) throw error;
      }
    }
  }

  return {
    title: "基础包",
    type: "main package",
    meta: [
      { label: "部署类型", value: deployType.toUpperCase() },
      { label: "基础包版本", value: version },
      { label: "下载有效期", value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions: versions,
    links,
  };
}

async function listBaseVersions(client, deployType, query) {
  deployType = normalizeString(deployType || "pro").toLowerCase();
  if (!baseListPrefixTemplate) return [];
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const packageNames = deployType === "pro" ? ["sealos-pro", "sealos-commercial"] : [`sealos-${deployType}`];
  const listPrefix = normalizePrefix(renderTemplate(baseListPrefixTemplate, { deployType, arch }));
  const objects = await listAllObjects(client, listPrefix);
  const versions = new Map();

  for (const object of objects) {
    const rest = object.name.slice(listPrefix.length);
    const parts = rest.split("/");
    if (parts.length < 2) continue;
    const version = normalizeVersion(parts[0]);
    const fileName = parts[1];
    const expectedNames = packageNames.flatMap((packageName) => candidateFileNames([`${packageName}-%s-%s.tar`], version, arch));
    if (!expectedNames.includes(fileName)) continue;
    const current = versions.get(version);
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(version, { version, object });
    }
  }

  return [...versions.values()]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }));
}

function releaseVersionFromObject(root, objectKey) {
  const rest = objectKey.slice(root.length);
  const parts = rest.split("/");
  return parts.length > 1 ? normalizeVersion(parts[0]) : "";
}

function ciRootsForRule(rule) {
  const roots = new Set();
  for (const root of rule.releaseRoots) {
    const normalized = root.replace(/\/+$/, "/");
    const match = normalized.match(/^(.*)\/releases?\/$/);
    if (match) {
      roots.add(`${match[1]}/ci/main/`);
    }
  }
  return [...roots];
}

function ciHashFromObject(root, objectKey) {
  const rest = objectKey.slice(root.length);
  const parts = rest.split("/");
  return parts.length > 1 ? normalizeString(parts[0]) : "";
}

function ciVersionFromHash(hash) {
  return `latest-${hash}`;
}

function ciCandidateFileNames(rule, hash, arch) {
  const formats = rule.ciFileNameFormats && rule.ciFileNameFormats.length > 0 ? rule.ciFileNameFormats : rule.fileNameFormats;
  return candidateFileNames(formats, hash, arch);
}

function formatCiLabel(item) {
  const date = item.lastModified ? new Date(item.lastModified) : null;
  const pad = (value) => String(value).padStart(2, "0");
  const time = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : "unknown time";
  return `${time} ${item.hash}`;
}

function flatSuffixes(rule, arch) {
  return normalizeList([rule.flatFileNameSuffix, ...rule.flatFileNameSuffixes]).map((suffix) => formatFileName(suffix, arch, arch));
}

function extractFlatVersion(rule, fileName, arch) {
  const prefix = rule.flatFileNamePrefix;
  if (!prefix || !fileName.startsWith(prefix)) return "";
  const suffixes = flatSuffixes(rule, arch).sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (!suffix || !fileName.endsWith(suffix)) continue;
    return normalizeVersion(fileName.slice(prefix.length, fileName.length - suffix.length));
  }
  return "";
}

function newestVersion(objects) {
  const versions = [...new Set(objects.map((item) => item.version).filter(Boolean))];
  versions.sort((a, b) => compareVersions(b, a));
  return versions[0] || "";
}

async function listReleaseVersions(client, rule, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const versions = new Map();

  for (const root of rule.releaseRoots) {
    const objects = await listAllObjects(client, root);
    for (const object of objects) {
      const version = releaseVersionFromObject(root, object.name);
      if (!version) continue;
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch);
      if (!expectedNames.some((name) => object.name === `${root}${version}/${name}`)) continue;
      const current = versions.get(version);
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(version, { version, object });
      }
    }
  }

  for (const root of rule.flatFileRoots) {
    const objects = await listAllObjects(client, root);
    for (const object of objects) {
      const fileName = object.name.slice(root.length);
      if (!fileName || fileName.includes("/")) continue;
      const version = extractFlatVersion(rule, fileName, arch);
      if (!version) continue;
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch);
      if (!expectedNames.includes(fileName)) continue;
      const current = versions.get(version);
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(version, { version, object });
      }
    }
  }

  return [...versions.values()]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }));
}

async function buildComboPackage(client, packageId, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const channel = normalizeString(query.get("channel") || "release").toLowerCase();
  const rule = loadRules().find((item) => item.id === packageId);
  if (!rule) throw new Error(`unknown package: ${packageId}`);
  if (channel === "ci") {
    return buildCiPackage(client, rule, query);
  }

  const matched = [];
  for (const root of rule.releaseRoots) {
    const objects = await listAllObjects(client, root);
    for (const object of objects) {
      const version = releaseVersionFromObject(root, object.name);
      if (!version) continue;
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch);
      if (expectedNames.some((name) => object.name === `${root}${version}/${name}`)) {
        matched.push({ version, object });
      }
    }
  }

  for (const root of rule.flatFileRoots) {
    const objects = await listAllObjects(client, root);
    for (const object of objects) {
      const fileName = object.name.slice(root.length);
      if (!fileName || fileName.includes("/")) continue;
      const version = extractFlatVersion(rule, fileName, arch);
      if (!version) continue;
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch);
      if (expectedNames.includes(fileName)) {
        matched.push({ version, object });
      }
    }
  }

  const releaseVersions = await listReleaseVersions(client, rule, query);
  const requestedVersion = normalizeVersion(query.get("releaseVersion") || "");
  const latest = requestedVersion || (releaseVersions[0] && releaseVersions[0].version) || newestVersion(matched);
  const latestObjects = matched.filter((item) => item.version === latest);

  return {
    title: rule.name,
    type: "combo package",
    meta: [
      { label: "规则 key", value: rule.id },
      { label: "最新版本", value: latest || "未找到" },
      { label: "下载有效期", value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions,
    links: latestObjects.map((item) => objectToLink(client, rule.name, item.version, item.object)),
  };
}

async function listCiVersions(client, rule, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const versions = new Map();

  for (const root of ciRootsForRule(rule)) {
    const objects = await listAllObjects(client, root);
    for (const object of objects) {
      const hash = ciHashFromObject(root, object.name);
      if (!hash) continue;
      const expectedNames = ciCandidateFileNames(rule, hash, arch);
      const fileName = object.name.slice(`${root}${hash}/`.length);
      if (!expectedNames.includes(fileName)) continue;
      const current = versions.get(hash);
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(hash, { hash, object });
      }
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      hash: item.hash,
      label: formatCiLabel({ hash: item.hash, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }));
}

async function buildCiPackage(client, rule, query) {
  const arch = normalizeString(query.get("arch") || "amd64").toLowerCase();
  const requestedHash = normalizeString(query.get("ciVersion"));
  const versions = await listCiVersions(client, rule, query);
  const hash = requestedHash || (versions[0] && versions[0].hash) || "";
  const matched = [];

  if (hash) {
    for (const root of ciRootsForRule(rule)) {
      const objects = await listAllObjects(client, `${root}${hash}/`);
      const expectedNames = ciCandidateFileNames(rule, hash, arch);
      for (const object of objects) {
        const fileName = object.name.slice(`${root}${hash}/`.length);
        if (expectedNames.includes(fileName)) {
          matched.push(object);
        }
      }
    }
  }

  const selected = versions.find((item) => item.hash === hash);
  return {
    title: rule.name,
    type: "ci package",
    meta: [
      { label: "规则 key", value: rule.id },
      { label: "测试版本", value: selected ? selected.label : "未找到" },
      { label: "下载有效期", value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    ciVersions: versions,
    links: matched.map((object) => objectToLink(client, rule.name, selected ? selected.label : hash, object)),
  };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/login") {
      if (!passwordHash) {
        return json(res, 500, { error: "服务未配置访问密码" });
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      if (sha256(body.password || "") !== passwordHash) {
        return json(res, 401, { error: "密码不正确" });
      }
      const payload = JSON.stringify({ ok: true });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Set-Cookie": `oss_ui_session=${encodeURIComponent(sessionCookieValue())}; HttpOnly; SameSite=Lax; Path=/`,
        "Cache-Control": "no-store",
      });
      res.end(payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const payload = JSON.stringify({ ok: true });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Set-Cookie": "oss_ui_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        "Cache-Control": "no-store",
      });
      res.end(payload);
      return;
    }

    if (!isAuthenticated(req)) {
      return json(res, 401, { error: "请先登录" });
    }

    const client = ossClient();

    if (req.method === "GET" && url.pathname === "/api/rules") {
      const yamlRules = publicRules();
      const yamlMiddlewareNames = new Set(yamlRules.filter((rule) => rule.category === "middleware").map((rule) => rule.name));
      return json(res, 200, {
        rules: [...yamlRules, ...(await publicProMiddlewareRules(client, yamlMiddlewareNames))],
        expireSeconds: downloadExpireSeconds,
        expireMinutes: Math.round(downloadExpireSeconds / 60),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/packages/base") {
      return json(res, 200, await buildBasePackage(client, url.searchParams));
    }

    if (req.method === "GET" && url.pathname === "/api/packages/base/release-versions") {
      return json(res, 200, {
        versions: await listBaseVersions(client, url.searchParams.get("deployType") || "pro", url.searchParams),
      });
    }

    const comboMatch = url.pathname.match(/^\/api\/packages\/([^/]+)$/);
    if (req.method === "GET" && comboMatch) {
      const packageId = decodeURIComponent(comboMatch[1]);
      const middlewareName = proMiddlewareNameFromId(packageId);
      if (middlewareName) {
        const channel = normalizeString(url.searchParams.get("channel") || "release").toLowerCase();
        return json(res, 200, channel === "ci"
          ? await buildProMiddlewareCiPackage(client, middlewareName, url.searchParams)
          : await buildProMiddlewarePackage(client, middlewareName, url.searchParams));
      }
      return json(res, 200, await buildComboPackage(client, packageId, url.searchParams));
    }

    const ciVersionsMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/ci-versions$/);
    if (req.method === "GET" && ciVersionsMatch) {
      const packageId = decodeURIComponent(ciVersionsMatch[1]);
      const middlewareName = proMiddlewareNameFromId(packageId);
      if (middlewareName) {
        return json(res, 200, { versions: await listProMiddlewareCiVersions(client, middlewareName, url.searchParams) });
      }
      const rule = loadRules().find((item) => item.id === packageId);
      if (!rule) throw new Error(`unknown package: ${packageId}`);
      return json(res, 200, { versions: await listCiVersions(client, rule, url.searchParams) });
    }

    const releaseVersionsMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/release-versions$/);
    if (req.method === "GET" && releaseVersionsMatch) {
      const packageId = decodeURIComponent(releaseVersionsMatch[1]);
      const middlewareName = proMiddlewareNameFromId(packageId);
      if (middlewareName) {
        return json(res, 200, { versions: await listProMiddlewareReleaseVersions(client, middlewareName, url.searchParams) });
      }
      const rule = loadRules().find((item) => item.id === packageId);
      if (!rule) throw new Error(`unknown package: ${packageId}`);
      return json(res, 200, { versions: await listReleaseVersions(client, rule, url.searchParams) });
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    return json(res, 500, { error: error.message || String(error) });
  }
}

function serveStatic(req, res, url) {
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(rootDir, relative);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`oss-ui listening on http://0.0.0.0:${port}`);
  console.log(`rules file configured: ${rulesFile ? "yes" : "no"}`);
  console.log(`download URL expire: ${downloadExpireSeconds}s`);
});
