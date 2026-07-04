import JSZip from "jszip";

interface EpubChapter {
  title: string;
  content: string;
}

interface EpubMetadata {
  title: string;
  author: string;
  publisher: string;
  contact: string;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatContentToXml(text: string): string {
  if (!text) return "";
  if (text.includes("<p>") || text.includes("<br")) return text;
  return text
    .split(/\n+/)
    .map(para => para.trim())
    .filter(para => para.length > 0)
    .map(para => `<p>${escapeXml(para)}</p>`)
    .join("\n");
}

export async function generateEpub(
  metadata: EpubMetadata,
  chapters: EpubChapter[]
): Promise<Blob> {
  const zip = new JSZip();
  const uuid = `urn:uuid:${crypto.randomUUID()}`;

  // mimetype MUST be first and uncompressed
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // META-INF/container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS")!;
  const xhtml = oebps.folder("xhtml")!;

  // stylesheet.css
  oebps.file(
    "stylesheet.css",
    `body {
  font-family: Georgia, "Times New Roman", Times, serif;
  margin: 8%;
  line-height: 1.7;
  text-align: justify;
  color: #111111;
  background-color: #ffffff;
}
h1 {
  text-align: center;
  margin-top: 20%;
  margin-bottom: 10%;
  font-size: 1.8em;
  font-weight: bold;
  line-height: 1.2;
}
h2 {
  text-align: center;
  margin-top: 15%;
  margin-bottom: 8%;
  font-size: 1.4em;
  font-weight: bold;
}
p {
  text-indent: 1.5em;
  margin-top: 0;
  margin-bottom: 0.6em;
}
p:first-of-type {
  text-indent: 0;
}
.cover-page {
  text-align: center;
  margin: 10% 5%;
}
.cover-title {
  font-size: 2.2em;
  font-weight: bold;
  margin-top: 20%;
  margin-bottom: 6%;
}
.cover-author {
  font-size: 1.3em;
  font-style: italic;
  margin-bottom: 30%;
}
.cover-pub-info {
  font-size: 0.9em;
  margin-top: 25%;
  color: #555555;
  line-height: 1.8;
}
`
  );

  // Cover page XHTML
  xhtml.file(
    "cover.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Cover</title>
  <link rel="stylesheet" href="../stylesheet.css" type="text/css"/>
</head>
<body>
  <div class="cover-page">
    <h1 class="cover-title">${escapeXml(metadata.title)}</h1>
    <div class="cover-author">By ${escapeXml(metadata.author)}</div>
    <div class="cover-pub-info">
      <p>Published by: ${escapeXml(metadata.publisher)}</p>
      <p>Contact: ${escapeXml(metadata.contact)}</p>
    </div>
  </div>
</body>
</html>`
  );

  // Chapter XHTMLs
  chapters.forEach((ch, idx) => {
    const chNum = idx + 1;
    xhtml.file(
      `chapter_${chNum}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" href="../stylesheet.css" type="text/css"/>
</head>
<body>
  <h2>${escapeXml(ch.title)}</h2>
  <div class="chapter-content">
    ${formatContentToXml(ch.content)}
  </div>
</body>
</html>`
    );
  });

  // content.opf
  let manifestXml = `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="stylesheet.css" media-type="text/css"/>
    <item id="cover-page" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>\n`;
  chapters.forEach((_, idx) => {
    manifestXml += `    <item id="ch-${idx + 1}" href="xhtml/chapter_${idx + 1}.xhtml" media-type="application/xhtml+xml"/>\n`;
  });

  let spineXml = `    <itemref idref="cover-page"/>\n`;
  chapters.forEach((_, idx) => {
    spineXml += `    <itemref idref="ch-${idx + 1}"/>\n`;
  });

  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator opf:role="aut">${escapeXml(metadata.author)}</dc:creator>
    <dc:publisher>${escapeXml(metadata.publisher)}</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">${uuid}</dc:identifier>
  </metadata>
  <manifest>
${manifestXml.trimEnd()}
  </manifest>
  <spine toc="ncx">
${spineXml.trimEnd()}
  </spine>
</package>`
  );

  // toc.ncx
  let navPointsXml = `    <navPoint id="navPoint-cover" playOrder="1">
      <navLabel><text>Cover</text></navLabel>
      <content src="xhtml/cover.xhtml"/>
    </navPoint>\n`;
  chapters.forEach((ch, idx) => {
    navPointsXml += `    <navPoint id="navPoint-${idx + 1}" playOrder="${idx + 2}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="xhtml/chapter_${idx + 1}.xhtml"/>
    </navPoint>\n`;
  });

  oebps.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uuid}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>${escapeXml(metadata.title)}</text>
  </docTitle>
  <navMap>
${navPointsXml.trimEnd()}
  </navMap>
</ncx>`
  );

  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  });
}
