"use strict";

// TODO:
//   - both: support parsing TTLs like 1D, 1W, 3h, 1w
//   - both: support multiline value format

const defaults = {
  parse: {
    replaceOrigin: false,
    crlf: false,
    defaultTTL: 60,
  },
  stringify: {
    crlf: false,
    sections: true,
  },
};

const re = /^([a-z0-9_.-@]+)?[\s]*([0-9]+)?[\s]*([a-z]+)[\s]+([a-z]+)[\s]+([^;]+);?(.+)?$/i;

function normalize(name) {
  name = (name || "").toLowerCase();
  if (name.endsWith(".") && name.length > 1) {
    name = name.substring(0, name.length - 1);
  }
  return name.replace(/\.{2,}/g, ".").replace(/@\./, "@");
}

function denormalize(name) {
  if (!name.endsWith(".") && name.length > 1) {
    name = `${name}.`;
  }
  return name.replace(/\.{2,}/g, ".").replace(/@\./, "@");
}

function esc(str) {
  return str.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function format(records, type, {origin, newline, sections} = {}) {
  let str = ``;

  if (sections) {
    str += `;; ${type} Records${newline}`;
  }

  for (const record of records) {
    let name = record.name || "";

    if (origin) {
      if (name === origin) {
        name = "@";
      } if (name.endsWith(origin)) {
        // subdomain, remove origin and trailing dots
        name = normalize(name.replace(new RegExp(esc(origin + ".") + "?$", "gm"), ""));
      } else {
        // assume it's a subdomain, remove trailing dots
        name = normalize(name);
      }
    } else {
      // assume it's a fqdn, add trailing dots
      name = denormalize(name);
    }

    const fields = [
      name,
      record.ttl,
      record.class,
      record.type,
      record.content,
    ];

    if (record.comment) {
      fields.push(`; ${record.comment}`);
    }

    str += `${fields.join("\t")}${newline}`;
  }
  return `${str}${sections ? newline : ""}`;
}

module.exports.parse = (str, {replaceOrigin, crlf, defaultTTL} = defaults.parse) => {
  const data = {records: []};
  const rawLines = str.split(/\r?\n/).map(l => l.trim());
  const lines = rawLines.filter(l => Boolean(l) && !l.startsWith(";"));
  const newline = crlf ? "\r\n" : "\n";

  // search for header
  const headerLines = [];
  let valid;
  for (const [index, line] of Object.entries(rawLines)) {
    if (line.startsWith(";;")) {
      headerLines.push(line.substring(2).trim());
    } else {
      const prev = rawLines[index - 1];
      if (line === "" && index > 1 && prev.startsWith(";;")) {
        valid = true;
        break;
      }
    }
  }
  if (valid && headerLines.length) {
    data.header = headerLines.join(newline);
  }

  if (replaceOrigin) {
    data.origin = replaceOrigin;
  } else {
    // search for $ORIGIN
    for (const line of lines) {
      if (line.startsWith("$ORIGIN ")) {
        data.origin = normalize(line.replace(/;.+/, "").trim().substring("$ORIGIN ".length));
        break;
      }
    }
  }

  // search for $TTL
  let ttlVariable;
  for (const line of lines) {
    if (line.startsWith("$TTL ")) {
      ttlVariable = Number(normalize(line.replace(/;.+/, "").trim().substring("$TTL ".length)));
      data.ttl = ttlVariable;
      break;
    }
  }

  // create records
  for (const line of lines) {
    let _, name, ttl, cls, type, content, comment;

    const match = re.exec(line) || [];
    if (match.length === 7) {
      [_, name, ttl, cls, type, content, comment] = match;
      if (name && !ttl && /^[0-9]+$/.test(name)) {
        ttl = name;
        name = undefined;
      }
    } else if (match.length === 6) {
      if (/^[0-9]+$/.test(match[1])) { // no name
        [_, ttl, cls, type, content, comment] = match;
      } else { // no ttl
        [_, name, cls, type, content, comment] = match;
      }
    } else if (match.length === 5) { // no name and ttl
      [_, cls, type, content, comment] = match;
    }

    if (ttl === undefined) {
      if (ttlVariable !== undefined) {
        ttl = ttlVariable;
      } else {
        ttl = defaultTTL;
      }
    }

    if (typeof ttl !== "number") {
      ttl = Number(ttl);
    }

    if (!name) {
      name = "";
    }

    if (!cls || !type || !content) continue;

    data.records.push({
      name: normalize((["", "@"].includes(name) && data.origin) ? data.origin : name),
      ttl,
      class: cls.toUpperCase(),
      type: type.toUpperCase(),
      content: (content || "").trim(),
      comment: (comment || "").trim() || null,
    });
  }

  return data;
};

module.exports.stringify = (data, {crlf, sections} = defaults.stringify) => {
  const recordsByType = {};
  const newline = crlf ? "\r\n" : "\n";

  for (const record of data.records) {
    if (!recordsByType[record.type]) recordsByType[record.type] = [];
    recordsByType[record.type].push(record);
  }

  let output = "";

  if (data.header) {
    output += data.header
      .split(/\r?\n/)
      .map(l => l.trim())
      .map(l => l ? `;; ${l}` : ";;")
      .join(newline)
      .trim() + `${newline}${newline}`;
  }

  const vars = [];
  if (data.origin) vars.push(`$ORIGIN ${denormalize(data.origin)}`);
  if (data.ttl) vars.push(`$TTL ${data.ttl}`);
  if (vars.length) output += vars.join(newline) + `${newline}${newline}`;

  const origin = normalize(data.origin);

  // output SOA first
  if (recordsByType.SOA) {
    output += format(recordsByType.SOA, "SOA", {origin, newline, sections});
    delete recordsByType.SOA;
  }

  for (const type of Object.keys(recordsByType).sort()) {
    output += format(recordsByType[type], type, {origin, newline, sections});
  }

  return `${output.trim()}${newline}`;
};
