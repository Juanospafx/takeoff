<?php
// funciones/time.php
function time_elapsed_string($datetime, $full = false) {
    global $appTimeZone;

    try {
        $tz = new DateTimeZone($appTimeZone);
        $now = new DateTime('now', $tz);
        $ago = new DateTime($datetime, $tz);
    } catch (Exception $e) {
        $now = new DateTime('now');
        $ago = new DateTime($datetime);
    }

    $diff = $now->diff($ago);

    $diff->w = floor($diff->d / 7);
    $diff->d -= $diff->w * 7;

    $string = array(
        'y' => 'year',
        'm' => 'month',
        'w' => 'week',
        'd' => 'day',
        'h' => 'hour',
        'i' => 'minute',
        's' => 'second',
    );

    foreach ($string as $k => &$v) {
        if ($diff->$k) {
            $v = $diff->$k . ' ' . $v . ($diff->$k > 1 ? 's' : '');
        } else {
            unset($string[$k]);
        }
    }

    if (!$full) $string = array_slice($string, 0, 1);

    if ($ago > $now) {
        return 'just now';
    }

    return $string ? implode(', ', $string) . ' ago' : 'just now';
}
?>
