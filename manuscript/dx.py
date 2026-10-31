"""Minimal OOXML writer that reproduces the direct formatting of the original IEEE-style manuscript
(Times New Roman, 10 pt body, two columns, single-column title block and wide floats)."""
import re, os, shutil, zipfile, struct
from xml.sax.saxutils import escape
FONT = '<w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/>'
PG = '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/><w:pgMar w:top="1080" w:right="900" w:bottom="1300" w:left="900" w:header="560" w:footer="560" w:gutter="0"/>'
HF = '<w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>'
def sect(cols, first=False):
    c = '<w:cols w:space="360" w:num="2" w:equalWidth="true"/>' if cols == 2 else ''
    return f'<w:sectPr>{HF}<w:type w:val="{"nextPage" if first else "continuous"}"/>{PG}<w:pgNumType/>{c}<w:docGrid w:linePitch="360"/></w:sectPr>'

def rpr(sz=20, b=False, i=False, sc=False, sup=False, sub=False, hl=False, caps=False):
    s = FONT
    if b: s += '<w:b/><w:bCs/>'
    if i: s += '<w:i/><w:iCs/>'
    if sc: s += '<w:smallCaps/>'
    if caps: s += '<w:caps/>'
    s += f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>'
    if hl: s += '<w:highlight w:val="yellow"/>'
    if sup: s += '<w:vertAlign w:val="superscript"/>'
    if sub: s += '<w:vertAlign w:val="subscript"/>'
    return f'<w:rPr>{s}</w:rPr>'
def run(t, **k):
    parts = t.split('\t'); out = ''
    for n, p in enumerate(parts):
        if n: out += f'<w:r>{rpr(**k)}<w:tab/></w:r>'
        if p: out += f'<w:r>{rpr(**k)}<w:t xml:space="preserve">{escape(p)}</w:t></w:r>'
    return out
TOK = re.compile(r'\{(i|b|sub|sup|hl|bi):([^{}]*)\}')
def runs(text, sz=20, **base):
    out = ''; pos = 0
    for m in TOK.finditer(text):
        if m.start() > pos: out += run(text[pos:m.start()], sz=sz, **base)
        kind, body = m.group(1), m.group(2); k = dict(base)
        if kind == 'i': k['i'] = True
        elif kind == 'b': k['b'] = True
        elif kind == 'bi': k['b'] = True; k['i'] = True
        elif kind == 'sub': k['sub'] = True
        elif kind == 'sup': k['sup'] = True
        elif kind == 'hl': k['hl'] = True
        out += run(body, sz=sz, **k); pos = m.end()
    if pos < len(text): out += run(text[pos:], sz=sz, **base)
    return out
def para(inner, ppr=''): return f'<w:p><w:pPr>{ppr}</w:pPr>{inner}</w:p>'
def body(text, first=True, after=0):
    return para(runs(text), f'<w:spacing w:after="{after}" w:line="240"/><w:ind w:firstLine="{240 if first else 0}"/><w:jc w:val="both"/>')
def h1(text): return para(runs(text, sc=True), '<w:pStyle w:val="H1"/>')
def h2(text): return para(runs(text, i=True), '<w:pStyle w:val="H2"/>')
def center(text, sz=20, after=0, before=0, keep=False, **k): return para(runs(text, sz=sz, **k), f'{"<w:keepNext/>" if keep else ""}<w:spacing w:after="{after}" w:before="{before}"/><w:jc w:val="center"/>')
def abstract(label, text, after=100):
    return para(run(label, sz=18, b=True, i=True) + runs(text, sz=18, b=True), f'<w:spacing w:after="{after}" w:line="220"/><w:ind w:firstLine="240"/><w:jc w:val="both"/>')
def caption_fig(n, text): return para(run(f'FIGURE {n}. ', sz=16, b=True, sc=True) + runs(text, sz=16), '<w:spacing w:after="160" w:before="0"/><w:jc w:val="both"/>')
def caption_tbl(n, text):
    return (para(run(f'TABLE {n}. ', sz=16, b=True, sc=True) + runs(text, sz=16, sc=False), '<w:keepNext/><w:spacing w:after="60" w:before="120"/><w:jc w:val="both"/>'))
def bullet(text, numId=4): return para(runs(text), f'<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{numId}"/></w:numPr><w:spacing w:after="20" w:line="240"/><w:jc w:val="both"/>')
def step(text, numId): return para(runs(text, sz=18), f'<w:pStyle w:val="ListParagraph"/><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{numId}"/></w:numPr><w:spacing w:after="20" w:line="230"/><w:jc w:val="left"/>')
def algtitle(n, text):
    return para(run(f'Algorithm {n}:', sz=18, b=True, i=True) + run(' ' + text, sz=18, b=True), '<w:keepNext/><w:pBdr><w:top w:val="single" w:color="000000" w:sz="6" w:space="2"/><w:bottom w:val="single" w:color="000000" w:sz="6" w:space="2"/></w:pBdr><w:spacing w:after="40" w:before="100"/>')
def ref(n, text): return para(run(f'[{n}]\t', sz=16) + runs(text, sz=16), '<w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="20" w:line="220"/><w:ind w:left="360" w:hanging="360"/><w:jc w:val="left"/>')

def table(rows, widths, header=1, sz=15, align=None, bold_first_col=False):
    tw = sum(widths); align = align or ['left'] + ['center'] * (len(widths) - 1)
    x = f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{tw}"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths) + '</w:tblGrid>'
    for ri, r in enumerate(rows):
        hdr = ri < header; last = ri == len(rows) - 1
        x += '<w:tr><w:trPr><w:cantSplit/>' + ('<w:tblHeader/>' if hdr else '') + '</w:trPr>'
        for ci, c in enumerate(r):
            top = '<w:top w:val="single" w:color="000000" w:sz="6"/>' if ri == 0 else '<w:top w:val="none" w:color="FFFFFF" w:sz="0"/>'
            bot = '<w:bottom w:val="single" w:color="000000" w:sz="6"/>' if (hdr and ri == header - 1) or last else '<w:bottom w:val="single" w:color="DDDDDD" w:sz="2"/>'
            x += (f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{widths[ci]}"/><w:tcBorders>{top}<w:left w:val="none" w:color="FFFFFF" w:sz="0"/>{bot}<w:right w:val="none" w:color="FFFFFF" w:sz="0"/></w:tcBorders>'
                  '<w:tcMar><w:top w:type="dxa" w:w="20"/><w:left w:type="dxa" w:w="45"/><w:bottom w:type="dxa" w:w="20"/><w:right w:type="dxa" w:w="45"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>')
            x += para(runs(str(c), sz=sz, b=hdr or (bold_first_col and ci == 0)), f'<w:spacing w:after="0" w:line="210"/><w:jc w:val="{"center" if hdr and ci else align[ci]}"/>') + '</w:tc>'
        x += '</w:tr>'
    return x + '</w:tbl>' + para('', '<w:spacing w:after="60" w:line="120" w:lineRule="exact"/>')

def png_size(p):
    with open(p, 'rb') as f: d = f.read(24)
    return struct.unpack('>II', d[16:24])
class Doc:
    def __init__(self): self.parts = []; self.imgs = []; self.cites = {}; self.reflist = []; self.refs = {}; self.docpr = 1
    def add(self, x): self.parts.append(x)
    def cite(self, *keys):
        nums = []
        for k in keys:
            if k not in self.cites: self.cites[k] = len(self.cites) + 1; self.reflist.append(k)
            nums.append(self.cites[k])
        nums.sort(); out = []; i = 0
        while i < len(nums):                       # IEEE style ranges  [1]–[3]
            j = i
            while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1: j += 1
            out.append(f'[{nums[i]}]' if i == j else (f'[{nums[i]}], [{nums[j]}]' if j == i + 1 else f'[{nums[i]}]–[{nums[j]}]')); i = j + 1
        return ', '.join(out)
    def figure(self, path, width_in, alt):
        w, h = png_size(path); cx = int(width_in * 914400); cy = int(cx * h / w); rid = f'rIdI{len(self.imgs) + 1}'; name = f'img{len(self.imgs) + 1}.png'
        self.imgs.append((rid, path, name)); self.docpr += 1
        d = (f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent t="0" r="0" b="0" l="0"/><wp:docPr id="{self.docpr}" name="fig{self.docpr}" descr="{escape(alt)}"/>'
             '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
             f'<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
             f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')
        return para(d, '<w:keepNext/><w:spacing w:after="40" w:before="80"/><w:jc w:val="center"/>')

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
def package(doc, template_dir, out, header_text, footer_left):
    tmp = out + '_build'; shutil.rmtree(tmp, ignore_errors=True); shutil.copytree(template_dir, tmp)
    shutil.rmtree(f'{tmp}/word/media', ignore_errors=True); os.makedirs(f'{tmp}/word/media')
    for rid, p, name in doc.imgs: shutil.copy(p, f'{tmp}/word/media/{name}')
    xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>' + ''.join(doc.parts) + sect(2) + '</w:body></w:document>'
    open(f'{tmp}/word/document.xml', 'w', encoding='utf8').write(xml)
    nb = open(f'{tmp}/word/numbering.xml', encoding='utf8').read()
    if 'w:numId="5"' not in nb:
        nb = nb.replace('</w:numbering>', '<w:num w:numId="5"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>')
        open(f'{tmp}/word/numbering.xml', 'w', encoding='utf8').write(nb)
    hdr = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {NS}>' + para(run(header_text, sz=16, i=True), '<w:pBdr><w:bottom w:val="single" w:color="000000" w:sz="4" w:space="1"/></w:pBdr><w:spacing w:after="0"/><w:jc w:val="left"/>') + '</w:hdr>'
    fld = '<w:r><w:rPr>' + FONT + '<w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr>' + FONT + '<w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr>' + FONT + '<w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr>' + FONT + '<w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr>' + FONT + '<w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
    ftr = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {NS}>' + para(run(footer_left, sz=16, b=True) + run('\t', sz=16) + fld, '<w:pBdr><w:top w:val="single" w:color="000000" w:sz="4" w:space="1"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="10440"/></w:tabs><w:spacing w:after="0"/>') + '</w:ftr>'
    open(f'{tmp}/word/header1.xml', 'w', encoding='utf8').write(hdr); open(f'{tmp}/word/footer1.xml', 'w', encoding='utf8').write(ftr)
    rels = open(f'{tmp}/word/_rels/document.xml.rels', encoding='utf8').read()
    rels = re.sub(r'<Relationship Id="rId\d+" Type="[^"]*/image" Target="[^"]*"/>', '', rels)
    add = ''.join(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{n}"/>' for rid, p, n in doc.imgs)
    add += '<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    open(f'{tmp}/word/_rels/document.xml.rels', 'w', encoding='utf8').write(rels.replace('</Relationships>', add + '</Relationships>'))
    ct = open(f'{tmp}/[Content_Types].xml', encoding='utf8').read()
    ct = ct.replace('</Types>', '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')
    open(f'{tmp}/[Content_Types].xml', 'w', encoding='utf8').write(ct)
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(f'{tmp}/[Content_Types].xml', '[Content_Types].xml')
        for root, _, files in os.walk(tmp):
            for f in files:
                full = os.path.join(root, f); arc = os.path.relpath(full, tmp)
                if arc != '[Content_Types].xml': z.write(full, arc)
    shutil.rmtree(tmp)

def omath_frac(n, d): return f'<m:f><m:num>{n}</m:num><m:den>{d}</m:den></m:f>'
def mr(t): return f'<m:r><m:t xml:space="preserve">{escape(t)}</m:t></m:r>'
def msub(b, s): return f'<m:sSub><m:sSubPr/><m:e>{mr(b)}</m:e><m:sub>{mr(s)}</m:sub></m:sSub>'
def msup(b, s): return f'<m:sSup><m:sSupPr/><m:e>{b}</m:e><m:sup>{mr(s)}</m:sup></m:sSup>'
def mbr(inner): return f'<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>{inner}</m:e></m:d>'
def eq(omml, n): 
    return para(f'<w:r>{rpr()}<w:tab/></w:r><m:oMath>{omml}</m:oMath><w:r>{rpr()}<w:tab/><w:t>({n})</w:t></w:r>', '<w:tabs><w:tab w:val="center" w:pos="2520"/><w:tab w:val="right" w:pos="5040"/></w:tabs><w:spacing w:after="40" w:before="40"/>')
