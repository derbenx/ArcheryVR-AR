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
            // Sanitize the filename to prevent directory traversal attacks.
            // basename() removes any directory information, ensuring we only have the filename.
            $safe_filename = basename($filename);
            $file_path = $target_dir . $safe_filename;

            // Double-check that the resolved path is still within our target directory.
            // realpath() resolves all symbolic links, '..' and '.' dots.
            if (realpath($file_path) && strpos(realpath($file_path), realpath($target_dir)) === 0) {
                // Check if the file exists and is a file before trying to delete it
                if (is_file($file_path)) {
                    unlink($file_path); // Delete the file
                }
            }
        }
    }
    // No need for a redirect, the script will just continue and render the updated file list below.
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
                // Scan the directory for files
                $files = scandir($target_dir);

                // Filter out '.' and '..' from the list
                $files = array_diff($files, array('.', '..'));

                if (empty($files)) {
                    echo "<li>No files found.</li>";
                } else {
                    // Loop through the files and create a list item with a checkbox and a link for each
                    foreach ($files as $file) {
                        $full_path = $target_dir . $file;
                        $link_path = $target_dir . htmlspecialchars($file);
                        // Append the file's last modification time as a cache-busting query string
                        $version = filemtime($full_path);

                        echo "<li>";
                        echo "<input type='checkbox' name='filesToDelete[]' value='" . htmlspecialchars($file) . "'>";
                        echo "<a href=\"$link_path?v=$version\">" . htmlspecialchars($file) . "</a>";
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