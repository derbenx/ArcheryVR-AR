<?php
// Set a default timezone to avoid warnings
date_default_timezone_set('UTC');

// Check if data was sent via POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get the raw POST data
    $data = file_get_contents('php://input');

    // Decode the JSON data
    $json_data = json_decode($data, true);

    // Check if JSON decoding was successful and if 'log_data' exists
    if (json_last_error() === JSON_ERROR_NONE && isset($json_data['log_data'])) {
        $log_message = $json_data['log_data'];

        // Prepare the log entry with a timestamp
        $log_entry = date('[Y-m-d H:i:s] ') . $log_message . PHP_EOL;

        // Append the log entry to the file
        // FILE_APPEND flag ensures data is added to the end of the file
        // LOCK_EX flag prevents other scripts from writing to the file at the same time
        file_put_contents('log.txt', $log_entry, FILE_APPEND | LOCK_EX);

        // Respond with a success message
        echo 'Log saved successfully.';
    } else {
        // Respond with an error if the data is invalid
        http_response_code(400); // Bad Request
        echo 'Invalid or missing log_data.';
    }
} else {
    // Respond with an error if the request method is not POST
    http_response_code(405); // Method Not Allowed
    echo 'This script only accepts POST requests.';
}
?>