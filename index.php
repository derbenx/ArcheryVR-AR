<?php
// --- Deletion Logic ---
$target_dir = 'data/';

// Check if the form was submitted via POST and 'filesToDelete' is set
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['filesToDelete'])) {
    $files_to_delete = $_POST['filesToDelete'];

    // Ensure it's an array before processing
    if (is_array($files_to_delete)) {
        foreach ($files_to_delete as $filename) {
            // --- Security Check ---
            $safe_filename = basename($filename);
            $file_path = $target_dir . $safe_filename;

            if (realpath($file_path) && strpos(realpath($file_path), realpath($target_dir)) === 0) {
                if (is_file($file_path)) {
                    unlink($file_path);
                }
            }
        }
    }
}

// Helper function to format bytes into a human-readable format
function formatSizeUnits($bytes) {
    if ($bytes >= 1073741824) {
        $bytes = number_format($bytes / 1073741824, 2) . ' GB';
    } elseif ($bytes >= 1048576) {
        $bytes = number_format($bytes / 1048576, 2) . ' MB';
    } elseif ($bytes >= 1024) {
        $bytes = number_format($bytes / 1024, 2) . ' KB';
    } elseif ($bytes > 1) {
        $bytes = $bytes . ' bytes';
    } elseif ($bytes == 1) {
        $bytes = $bytes . ' byte';
    } else {
        $bytes = '0 bytes';
    }
    return $bytes;
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>File List</title>
    <style>
        body { font-family: sans-serif; padding: 2em; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 8px 0; display: flex; align-items: center; }
        a { text-decoration: none; color: #007bff; margin-left: 10px;}
        a:hover { text-decoration: underline; }
        .filesize { color: #6c757d; margin-left: 1em; font-size: 0.9em; }
        input[type="checkbox"] { margin-right: 10px; }
        input[type="submit"] { margin-top: 1em; padding: 8px 15px; border: none; cursor: pointer; }
        .delete-btn { background-color: #dc3545; color: white; }
        .delete-btn:hover { background-color: #c82333; }
        .upload-btn { background-color: #007bff; color: white; }
        .upload-btn:hover { background-color: #0069d9; }
    </style>
</head>
<body>

    <h1>Saved Files</h1>

    <form action="index.php" method="post">
        <ul>
            <?php
            // Check if the directory exists
            if (is_dir($target_dir)) {
                $files = scandir($target_dir);
                $files = array_diff($files, array('.', '..'));

                if (empty($files)) {
                    echo "<li>No files found.</li>";
                } else {
                    foreach ($files as $file) {
                        $full_path = $target_dir . $file;
                        $link_path = $target_dir . htmlspecialchars($file);
                        $version = filemtime($full_path);
                        $size = formatSizeUnits(filesize($full_path));

                        echo "<li>";
                        echo "<input type='checkbox' name='filesToDelete[]' value='" . htmlspecialchars($file) . "'>";
                        echo "<a href=\"$link_path?v=$version\">" . htmlspecialchars($file) . "</a>";
                        echo "<span class='filesize'>($size)</span>";
                        echo "</li>";
                    }
                }
            } else {
                echo "<li>Error: 'data' directory not found.</li>";
            }
            ?>
        </ul>
        <?php
        if (!empty($files)) {
            echo '<input type="submit" value="Delete Selected Files" class="delete-btn">';
        }
        ?>
    </form>

    <hr style="margin-top: 2em;">

    <h2>Upload New File</h2>
    <form action="sav.php" method="post" enctype="multipart/form-data">
      Select file to upload:
      <input type="file" name="fileToUpload" id="fileToUpload">
      <input type="submit" value="Upload File" name="submit" class="upload-btn">
    </form>

</body>
</html>