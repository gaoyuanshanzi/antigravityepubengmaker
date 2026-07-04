import JSZip from "jszip";

interface EpubChapter {
  title: string;
  content: string; // Raw or HTML content
  illustrationUrl?: string; // Pollinations image URL
  illustrationBlob?: Blob; // Prefetched blob
}

interface EpubMetadata {
  title: string;
  author: string;
  publisher: string;
  contact: string;
  coverUrl?: string;
  coverBlob?: Blob; // Prefetched cover blob
}

// Simple helper to clean text and make it XML safe
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Convert paragraphs to XHTML paragraphs
function formatContentToXml(text: string): string {
  if (!text) return "";
  
  // If it already looks like HTML, return it
  if (text.includes("<p>") || text.includes("<br")) {
    return text;
  }

  // Otherwise, split by newlines and wrap in paragraphs
  return text
    .split(/\n+/)
    .map(para => para.trim())
    .filter(para => para.length > 0)
    .map(para => `<p>${escapeXml(para)}</p>`)
    .join("\n");
}

export async function generateEpub(metadata: EpubMetadata, chapters: EpubChapter[]): Promise<Blob> {
  const zip = new JSZip();
  const uuid = `urn:uuid:${crypto.randomUUID()}`;

  // 1. mimetype (MUST be first file, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file("META-INF/container.xml", containerXml);

  // Prepare folders
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder in zip");
  
  const xhtml = oebps.folder("xhtml");
  const images = oebps.folder("images");
  if (!xhtml || !images) throw new Error("Failed to create subfolders in zip");

  // Keep track of all added images
  const manifestImages: { id: string; href: string; mediaType: string }[] = [];

  // Add cover image if exists
  let hasCoverImage = false;
  if (metadata.coverBlob) {
    images.file("cover.jpg", metadata.coverBlob);
    manifestImages.push({
      id: "cover-image",
      href: "images/cover.jpg",
      mediaType: "image/jpeg",
    });
    hasCoverImage = true;
  }

  // Add chapter illustration images
  const updatedChapters = await Promise.all(
    chapters.map(async (ch, idx) => {
      const chNum = idx + 1;
      let imgId = "";
      let imgHref = "";
      
      let blob = ch.illustrationBlob;
      if (!blob && ch.illustrationUrl) {
        try {
          const res = await fetch(ch.illustrationUrl);
          if (res.ok) {
            blob = await res.blob();
          }
        } catch (e) {
          console.error(`Failed to fetch illustration for chapter ${chNum}:`, e);
        }
      }

      if (blob) {
        const filename = `chapter_${chNum}.jpg`;
        images.file(filename, blob);
        imgId = `img-ch-${chNum}`;
        imgHref = `images/${filename}`;
        manifestImages.push({
          id: imgId,
          href: imgHref,
          mediaType: "image/jpeg",
        });
      }

      return {
        ...ch,
        imgId,
        imgHref,
      };
    })
  );

  // 3. OEBPS/stylesheet.css
  const stylesheetCss = `body {
  font-family: serif;
  margin: 8%;
  line-height: 1.5;
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
  margin-bottom: 0.5em;
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
  margin-top: 15%;
  margin-bottom: 5%;
}

.cover-author {
  font-size: 1.2em;
  font-style: italic;
  margin-bottom: 25%;
}

.cover-pub-info {
  font-size: 0.9em;
  margin-top: 20%;
  color: #555555;
  line-height: 1.6;
}

.illustration-container {
  text-align: center;
  margin: 1.5em 0;
  page-break-inside: avoid;
}

.illustration {
  max-width: 100%;
  max-height: 60vh;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}
`;
  oebps.file("stylesheet.css", stylesheetCss);

  // 4. Create Cover Page XHTML
  const coverHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Cover</title>
  <link rel="stylesheet" href="../stylesheet.css" type="text/css"/>
</head>
<body>
  <div class="cover-page">
    ${
      hasCoverImage
        ? `<div class="illustration-container"><img class="illustration" src="../images/cover.jpg" alt="Cover Image"/></div>`
        : ""
    }
    <h1 class="cover-title">${escapeXml(metadata.title)}</h1>
    <div class="cover-author">By ${escapeXml(metadata.author)}</div>
    <div class="cover-pub-info">
      <p>Published by: ${escapeXml(metadata.publisher)}</p>
      <p>Contact: ${escapeXml(metadata.contact)}</p>
    </div>
  </div>
</body>
</html>`;
  xhtml.file("cover.xhtml", coverHtml);

  // 5. Create Chapter XHTMLs
  updatedChapters.forEach((ch, idx) => {
    const chNum = idx + 1;
    const hasImage = !!ch.imgHref;
    
    const chapterHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" href="../stylesheet.css" type="text/css"/>
</head>
<body>
  <h2>${escapeXml(ch.title)}</h2>
  ${
    hasImage
      ? `<div class="illustration-container">
          <img class="illustration" src="../${ch.imgHref}" alt="${escapeXml(ch.title)} Illustration"/>
         </div>`
      : ""
  }
  <div class="chapter-content">
    ${formatContentToXml(ch.content)}
  </div>
</body>
</html>`;
    xhtml.file(`chapter_${chNum}.xhtml`, chapterHtml);
  });

  // 6. OEBPS/content.opf
  // Generate Manifest
  let manifestXml = `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="stylesheet.css" media-type="text/css"/>
    <item id="cover-page" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>\n`;

  updatedChapters.forEach((_, idx) => {
    const chNum = idx + 1;
    manifestXml += `    <item id="ch-${chNum}" href="xhtml/chapter_${chNum}.xhtml" media-type="application/xhtml+xml"/>\n`;
  });

  manifestImages.forEach(img => {
    manifestXml += `    <item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"/>\n`;
  });

  // Generate Spine
  let spineXml = `    <itemref idref="cover-page"/>\n`;
  updatedChapters.forEach((_, idx) => {
    spineXml += `    <itemref idref="ch-${idx + 1}"/>\n`;
  });

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator opf:role="aut">${escapeXml(metadata.author)}</dc:creator>
    <dc:publisher>${escapeXml(metadata.publisher)}</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    ${hasCoverImage ? `<meta name="cover" content="cover-image"/>` : ""}
  </metadata>
  <manifest>
${manifestXml.trimEnd()}
  </manifest>
  <spine toc="ncx">
${spineXml.trimEnd()}
  </spine>
</package>`;
  oebps.file("content.opf", contentOpf);

  // 7. OEBPS/toc.ncx
  let navPointsXml = `    <navPoint id="navPoint-cover" playOrder="1">
      <navLabel><text>Cover</text></navLabel>
      <content src="xhtml/cover.xhtml"/>
    </navPoint>\n`;

  updatedChapters.forEach((ch, idx) => {
    const chNum = idx + 1;
    navPointsXml += `    <navPoint id="navPoint-${chNum}" playOrder="${chNum + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="xhtml/chapter_${chNum}.xhtml"/>
    </navPoint>\n`;
  });

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
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
</ncx>`;
  oebps.file("toc.ncx", tocNcx);

  // Generate EPUB file (zip format)
  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  });
}
