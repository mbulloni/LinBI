"""Write an Analysis Services backup (ABF) as found in the DataModel part of a .pbix.

Layout (all offsets in bytes):
  0      STREAM_STORAGE_SIGNATURE (UTF-16LE with BOM, 72 bytes)
  72     BackupLogHeader XML (UTF-16LE, no BOM), zero padded to 4096
  4096   files back to back: ADDITIONAL_LOG, PARTITIONS, <db>.xml, db files..., LOG
  page   VirtualDirectory XML (UTF-8), zero padded to the next page
ErrorCode=false: no 4-byte checksum after each file.
"""
import uuid
from xml.sax.saxutils import escape

PAGE = 0x1000
SIG = b'\xff\xfe' + 'STREAM_STORAGE_SIGNATURE_)!@#$%^&*('.encode('utf-16le')
BOM16 = b'\xff\xfe'


def _storage_id():
    return uuid.uuid4().hex.upper()[:20]


def _pad(n):
    return (-n) % PAGE


def write_abf(db_id, db_files, db_xml, root='\\\\?\\C:\\LinBI\\Data', language=1033, ts=134057844561561494):
    """db_files: list of (relative path inside <db>.0.db, bytes); db_xml: bytes of <db>.0.db.xml."""
    db_dir = f'{root}\\{db_id}.0.db'
    entries = []  # (vd path, bytes, full path or None, filegroup)
    entries.append(('ADDITIONAL_LOG', BOM16 + '<Property><ProductName>Default</ProductName></Property>'.encode('utf-16le'), None, None))
    entries.append(('PARTITIONS', BOM16 + '<Partitions/>'.encode('utf-16le'), None, None))
    entries.append((_storage_id(), db_xml, f'{db_dir}.xml', 0))
    for rel, data in db_files:
        fg = 0 if rel.endswith('CryptKey.bin') else 1
        entries.append((_storage_id(), data, f'{db_dir}\\{rel}', fg))

    def bf(full, sp, size):
        return (f'<BackupFile><Path>{escape(full)}</Path><StoragePath>{sp}</StoragePath>'
                f'<LastWriteTime>{ts}</LastWriteTime><Size>{size}</Size></BackupFile>')

    fg_files = {0: [], 1: []}
    for sp, data, full, fg in entries:
        if full is not None:
            fg_files[fg].append(bf(full, sp, len(data)))

    def filegroup(cls, version, loc, oid, files):
        return (f'<FileGroup><Class>{cls}</Class><ID>{db_id}</ID><Name>{db_id}</Name><ObjectVersion>{version}</ObjectVersion>'
                f'<PersistLocation>{loc}</PersistLocation><PersistLocationPath>{escape(db_dir)}</PersistLocationPath>'
                f'<StorageLocationPath/><ObjectID>{oid}</ObjectID><FileList>{"".join(files)}</FileList></FileGroup>')

    log = ('<BackupLog><BackupRestoreSyncVersion>11.53</BackupRestoreSyncVersion>'
           f'<ServerRoot>{escape(root)}</ServerRoot><SvrEncryptPwdFlag>true</SvrEncryptPwdFlag>'
           '<ServerEnableBinaryXML>false</ServerEnableBinaryXML><ServerEnableCompression>false</ServerEnableCompression>'
           '<CompressionFlag>false</CompressionFlag><EncryptionFlag>false</EncryptionFlag>'
           f'<ObjectName>{db_id}</ObjectName><ObjectId>{db_id}</ObjectId><Write>ReadWrite</Write><OlapInfo>false</OlapInfo>'
           f'<IsTabular>true</IsTabular><Collations/><Languages><Language>{language}</Language></Languages><FileGroups>'
           + filegroup(100002, 0, 0, str(uuid.uuid4()).upper(), fg_files[0])
           + filegroup(100069, -1, -1, '00000000-0000-0000-0000-000000000000', fg_files[1])
           + '</FileGroups></BackupLog>')
    entries.append(('LOG', BOM16 + log.encode('utf-16le'), None, None))

    out = bytearray(PAGE)
    vd = ['<VirtualDirectory>']
    for sp, data, _, _ in entries:
        off = len(out)
        out += data
        vd.append(f'<BackupFile><Path>{sp}</Path><Size>{len(data)}</Size><m_cbOffsetHeader>{off}</m_cbOffsetHeader>'
                  f'<Delete>false</Delete><CreatedTimestamp>{ts}</CreatedTimestamp><Access>{ts}</Access>'
                  f'<LastWriteTime>{ts}</LastWriteTime></BackupFile>')
    vd.append('</VirtualDirectory>')
    out += bytes(_pad(len(out)))
    vd_off = len(out)
    vd_bytes = ''.join(vd).encode('utf-8')
    out += vd_bytes + bytes(_pad(len(vd_bytes)))

    header = ('<BackupLog><BackupRestoreSyncVersion>140</BackupRestoreSyncVersion><Fault>false</Fault><faultcode>0</faultcode>'
              '<ErrorCode>false</ErrorCode><EncryptionFlag>false</EncryptionFlag><EncryptionKey>0</EncryptionKey>'
              f'<ApplyCompression>false</ApplyCompression><m_cbOffsetHeader>{vd_off}</m_cbOffsetHeader>'
              f'<DataSize>{len(vd_bytes)}</DataSize><Files>{len(entries)}</Files>'
              f'<ObjectID>{str(uuid.uuid4()).upper()}</ObjectID><m_cbOffsetData>{PAGE}</m_cbOffsetData></BackupLog>').encode('utf-16le')
    out[0:len(SIG)] = SIG
    out[72:72 + len(header)] = header
    return bytes(out)


XPRESS9_SIGNATURE = 'This backup was created using XPress9 compression.\x00'.encode('utf-16le')  # 102 bytes
XPRESS9_CHUNK = 2 << 20


def compress_xpress9(abf):
    """DataModel stream as Power BI Desktop writes it: signature, then 2 MiB chunks (u32 size, u32 compressed size,
    data) compressed with one XPress9 context (the history window carries over between chunks)."""
    from xpress9 import Xpress9
    x = Xpress9()
    out = bytearray(XPRESS9_SIGNATURE)
    for i in range(0, len(abf), XPRESS9_CHUNK):
        chunk = abf[i:i + XPRESS9_CHUNK]
        c = x.compress(chunk, len(chunk) + 65536)
        out += len(chunk).to_bytes(4, 'little') + len(c).to_bytes(4, 'little') + c
    return bytes(out)
