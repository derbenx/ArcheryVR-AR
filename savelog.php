<?php
// Set a default timezone to avoid warnings
date_default_timezone_set('UTC');

// Check if data was sent via POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Check if the expected 'hit' and 'score' fields are present in the POST data
    if (isset($_POST['hit']) && isset($_POST['score'])) {
        $hitObject = $_POST['hit'];
        $assignedScore = $_POST['score'];

        // Prepare the log message from the form data
        $log_message = "Hit: " . $hitObject . ", Score: " . $assignedScore;

        // Prepare the final log entry with a timestamp
        $log_entry = date('[Y-m-d H:i:s] ') . $log_message . PHP_EOL;

        // Append the log entry to the file
        // FILE_APPEND flag ensures data is added to the end of the file
        // LOCK_EX flag prevents other scripts from writing to the file at the same time
        if (file_put_contents('log.txt', $log_entry, FILE_APPEND | LOCK_EX) !== false) {
            // Respond with a success message
            echo 'Log saved successfully.';
        } else {
            // Respond with a server error if the file cannot be written to
            http_response_code(500); // Internal Server Error
            echo 'Error writing to log file. Check permissions.';
        }
    } else {
        // Respond with an error if the data is invalid
        http_response_code(400); // Bad Request
        echo 'Invalid or missing POST data. Expected "hit" and "score" fields.';
    }
} else {
    // Respond with an error if the request method is not POST
    http_response_code(405); // Method Not Allowed
    echo 'This script only accepts POST requests.';
}
?>