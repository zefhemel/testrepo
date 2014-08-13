var $setTimeout = window.setTimeout;
window.setTimeout = function() {
    process.stdout.write(".");
    $setTimeout.apply(window, arguments);
};
var $setInterval = window.setInterval;
var $intervalNo = 0;
window.setInterval = function(fn, interval) {
    $intervalNo++;
    $setInterval(function() {
        process.stdout.write("*");
        console.log("fn", fn);
        fn();
    }, interval);
};
