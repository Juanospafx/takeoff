<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/CatalogAdminService.php';

const CATALOG_PDF_MAX_BYTES = 10485760;

function cia_json(array $body, int $status=200): void
{ http_response_code($status); header('Content-Type: application/json; charset=utf-8'); echo json_encode($body,JSON_UNESCAPED_SLASHES); exit; }

function cia_storage_root(): string
{
    $configured=trim((string)getenv('TAKEOFF_PRIVATE_STORAGE'));
    $base=$configured!==''?$configured:dirname(__DIR__,3).DIRECTORY_SEPARATOR.'.takeoff-private';
    return rtrim($base,"/\\").DIRECTORY_SEPARATOR.'catalog-item-pdfs';
}

function cia_storage_path(string $name, bool $mustExist=false): string
{
    if (!preg_match('/^[a-f0-9]{48}\.pdf$/D',$name)) throw new RuntimeException('Invalid managed storage identifier.');
    $root=cia_storage_root();
    if (!is_dir($root) && !mkdir($root,0700,true) && !is_dir($root)) throw new RuntimeException('Private attachment storage is unavailable.');
    $path=$root.DIRECTORY_SEPARATOR.$name;
    if ($mustExist) {
        $realRoot=realpath($root); $real=realpath($path);
        if ($realRoot===false || $real===false || strpos($real,$realRoot.DIRECTORY_SEPARATOR)!==0) throw new RuntimeException('Attachment file was not found.');
        return $real;
    }
    return $path;
}

function cia_safe_original_name(string $name): string
{
    $name=preg_replace('/[\x00-\x1F\x7F]+/u','',str_replace('\\','/',$name)) ?? '';
    $name=basename($name); $base=pathinfo($name,PATHINFO_FILENAME);
    $base=trim(mb_substr($base,0,180)); return ($base!==''?$base:'catalog-item').'.pdf';
}

$action=(string)($_GET['action']??$_POST['action']??'');
try {
    if ($action==='view') {
        if (!catalog_ra_table_exists($pdo,'catalog_item_attachments')) { http_response_code(404); exit; }
        $id=(int)($_GET['item_id']??0);
        $stmt=$pdo->prepare('SELECT a.storage_name,a.size_bytes FROM catalog_item_attachments a
            JOIN catalog_items i ON i.id=a.catalog_item_id JOIN catalogs c ON c.id=i.catalog_id
            WHERE a.catalog_item_id=? AND i.active=1 AND i.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1');
        $stmt->execute([$id]); $row=$stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) { http_response_code(404); exit; }
        $path=cia_storage_path((string)$row['storage_name'],true);
        header('Content-Type: application/pdf'); header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: sandbox"); header('Content-Disposition: inline; filename="catalog-item.pdf"');
        header('Content-Length: '.(string)filesize($path)); readfile($path); exit;
    }

    if ($_SERVER['REQUEST_METHOD']!=='POST') cia_json(['status'=>'error','msg'=>'Method not allowed.'],405);
    $service=new CatalogAdminService($pdo);
    if ($action==='upload') {
        $id=(int)($_POST['item_id']??0); $file=$_FILES['pdf']??null;
        if (!is_array($file) || (int)($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK) cia_json(['status'=>'error','msg'=>'Choose a PDF to upload.'],422);
        $size=(int)($file['size']??0); $tmp=(string)($file['tmp_name']??'');
        if ($size<1 || $size>CATALOG_PDF_MAX_BYTES) cia_json(['status'=>'error','msg'=>'PDF must be 10 MB or smaller.'],413);
        if (!is_uploaded_file($tmp)) cia_json(['status'=>'error','msg'=>'Invalid upload.'],422);
        $finfo=new finfo(FILEINFO_MIME_TYPE);
        if ($finfo->file($tmp)!=='application/pdf') cia_json(['status'=>'error','msg'=>'The selected file is not a PDF.'],415);
        $fh=fopen($tmp,'rb'); $magic=$fh?fread($fh,5):''; if ($fh) fclose($fh);
        if ($magic!=='%PDF-') cia_json(['status'=>'error','msg'=>'The selected file is not a valid PDF.'],415);
        $storage=bin2hex(random_bytes(24)).'.pdf'; $destination=cia_storage_path($storage);
        if (!move_uploaded_file($tmp,$destination)) throw new RuntimeException('Unable to store uploaded PDF.');
        @chmod($destination,0600);
        try {
            $payload=['item_id'=>$id,'storage_name'=>$storage,'original_name'=>cia_safe_original_name((string)($file['name']??'')),
                'size_bytes'=>$size,'sha256'=>hash_file('sha256',$destination),'expected_revision'=>$_POST['expected_revision']??null,
                'request_id'=>catalog_ra_request_id($_POST)];
            $result=$service->replaceItemPdf($payload);
        } catch (Throwable $e) { @unlink($destination); throw $e; }
        $old=$result['previous_storage_name']??null; if ($old && $old!==$storage) { try { @unlink(cia_storage_path((string)$old,true)); } catch(Throwable $ignored) {} }
        cia_json(['status'=>'success','id'=>$id,'revision'=>$result['entity']['revision']??null]);
    }
    if ($action==='remove') {
        $input=json_decode(file_get_contents('php://input'),true); if(!is_array($input))$input=[];
        $result=$service->removeItemPdf(['item_id'=>(int)($input['item_id']??0),'expected_revision'=>$input['expected_revision']??null,'request_id'=>catalog_ra_request_id($input)]);
        $old=$result['previous_storage_name']??null; if($old){try{@unlink(cia_storage_path((string)$old,true));}catch(Throwable $ignored){}}
        cia_json(['status'=>'success','id'=>$result['id'],'revision'=>$result['entity']['revision']??null]);
    }
    cia_json(['status'=>'error','msg'=>'Unknown attachment action.'],404);
} catch (CatalogRevisionConflict $e) { cia_json(['status'=>'error','code'=>'revision_conflict','msg'=>$e->getMessage(),'current'=>$e->current],409);
} catch (CatalogAdminException $e) { cia_json(['status'=>'error','code'=>strtolower($e->errorCode),'msg'=>$e->getMessage()],$e->httpStatus);
} catch (Throwable $e) { error_log('catalog_item_attachment: '.$e->getMessage()); cia_json(['status'=>'error','msg'=>'Unable to process the PDF attachment.'],500); }
