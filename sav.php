<?php
$target_dir = "data/";

// Check if a file was uploaded via POST
if (isset($_FILES["fileToUpload"])) {
    $file = $_FILES["fileToUpload"];

    // Check for any upload errors
    if ($file["error"] !== UPLOAD_ERR_OK) {
        http_response_code(500);
        die("Error during file upload: " . $file["error"]);
    }

    $original_filename = basename($file["name"]);
    $original_filepath = $target_dir . $original_filename;

    // Move the uploaded temporary file to the final destination with its original name
    if (move_uploaded_file($file["tmp_name"], $original_filepath)) {
        echo "File ". htmlspecialchars($original_filename). " uploaded successfully.<br>";

        // Prepare for versioning
        $path_parts = pathinfo($original_filepath);
        $filename_no_ext = $path_parts['filename'];
        $extension = isset($path_parts['extension']) ? '.' . $path_parts['extension'] : '';

        $version = 1;
        // Loop to find the next available version number
        while (true) {
            $versioned_filename = $filename_no_ext . "-v" . $version . $extension;
            $versioned_filepath = $target_dir . $versioned_filename;
            if (!file_exists($versioned_filepath)) {
                break;
            }
            $version++;
        }

        // Create the new versioned copy
        if (copy($original_filepath, $versioned_filepath)) {
            echo "Versioned copy created: " . htmlspecialchars($versioned_filename);
        } else {
            http_response_code(500);
            echo "Error: Failed to create versioned copy.";
        }

    } else {
        http_response_code(500);
        echo "Error: Failed to move uploaded file.";
    }
} else {
    // If the page is accessed without a file upload, show a simple form.
    // This also serves as a basic check that the script is accessible.
    echo <<<HTML
<!DOCTYPE html>
<html>
<body>

<form action="sav.php" method="post" enctype="multipart/form-data">
  Select file to upload:
  <input type="file" name="fileToUpload" id="fileToUpload">
  <input type="submit" value="Upload File" name="submit">
</form>

</body>
</html>
HTML;
}
?>