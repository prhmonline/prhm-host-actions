<?php
/** @var $reserve \common\models\Reserve */
/** @var bool|null $pdfMode */
$pdfMode = isset($pdfMode) ? (bool)$pdfMode : true;
echo $this->renderFile(Yii::getAlias('@app/views/admin-reserve/print-ticket-new.php'), ['reserve'=>$reserve,'pdfMode'=>$pdfMode]);
