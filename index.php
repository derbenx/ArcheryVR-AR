<!DOCTYPE html>
<html>
<head>
    <title>File List</title>
    <style>
        body { font-family: sans-serif; padding: 2em; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 5px 0; }
        a { text-decoration: none; color: #007bff; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>

    <h1>Saved Files</h1>

    <ul>
        <?php
        $dir = 'data/';
        // Check if the directory exists
        if (is_dir($dir)) {
            // Scan the directory for files
            $files = scandir($dir);

            // Filter out '.' and '..' from the list
            $files = array_diff($files, array('.', '..'));

            if (empty($files)) {
                echo "<li>No files found.</li>";
            } else {
                // Loop through the files and create a list item with a link for each
                foreach ($files as $file) {
                    $filepath = $dir . htmlspecialchars($file);
                    echo "<li><a href=\"$filepath\">" . htmlspecialchars($file) . "</a></li>";
                }
            }
        } else {
            echo "<li>Error: 'data' directory not found.</li>";
        }
        ?>
    </ul>

</body>
</html>