## api path error (guess we need to remove /api here ? confirm for me)
7de9141b1af425c3.js:1 Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
    at rK (7de9141b1af425c3.js:1:46764)
    at io (7de9141b1af425c3.js:1:97485)
    at sc (7de9141b1af425c3.js:1:137956)
    at 7de9141b1af425c3.js:1:132846
    at u9 (7de9141b1af425c3.js:1:132947)
    at sV (7de9141b1af425c3.js:1:159329)
    at MessagePort.O (7de9141b1af425c3.js:1:8295)
contentScript.js:49 dispatching the event: emc.ctf.addonInited
/fdalabel-v3_api/api/drugtox/drugs/569e8a5a-ddf7-ebbc-e063-6294a90ab7a4:1  Failed to load resource: the server responded with a status of 404 ()
/fdalabel-v3_api/api/dashboard/dict/assess/569e8a5a-ddf7-ebbc-e063-6294a90ab7a4:1  Failed to load resource: the server responded with a status of 404 ()
ad423c1fe4a92050.js:1 Error generating dict report: AxiosError: Request failed with status code 404
    at eT (d4bed4d75a37f4f1.js:1:17154)
    at XMLHttpRequest.b (d4bed4d75a37f4f1.js:1:21525)
    at tt.request (d4bed4d75a37f4f1.js:1:29959)
    at async Z (ad423c1fe4a92050.js:1:36519)
Z @ ad423c1fe4a92050.js:1
/fdalabel-v3/fdalabel-v3/dashboard/label/569e8a5a-ddf7-ebbc-e063-6294a90ab7a4?_rsc=119bi:1  Failed to load resource: the server responded with a status of 404 ()

## agent page view
remove navi bar (dashboard > drug-name > ...) in the tool page (like DILI agent)


## history:
make it concise (less height), add a filter for time range (last 7 days, 30 days, 3 months, 1 year, all); add pagination with 10 records per page.