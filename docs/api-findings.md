## Find networks by city name
- Candidate keys to match a city:
 * the full normalized name ("san francisco, ca"),
 * the part before the first comma ("san francisco"),
 * the content of any parentheses, for bilingual entries ("京都府 (kyoto)" -> "kyoto"). 
- The networkId=mibisivalencia has a neighborhood name with the city name: "Valencia, área metropolitana" and has been included in the search
- The networkId=bay-wheels has a neighborhood name with the city name: "San Francisco Bay Area, CA" and has been included in the search
- The networkId=charichari-kyoto-otsu has a neighborhood name with the city name: "Kyoto/Otsu", don't have the city name in Japanese and has been included in the search

## Get networks data
- When bursting the "http://api.citybik.es/v2/networks/network_id" API retuns this error: CityBikes request failed for https://api.citybik.es/v2/networks/callabike-berlin: HTTP 429
- When testing the "Record" mode exceeded the API limits and received the error with status 429:
  * {
      "message": "Rate limit exceeded. Contact info@citybik.es for an access token. Thanks :)",
      "request_id": "21096752b04ebb151c5dfc67a5c1a54c"
    } 
  * With the response headers is possible to manage the remaining requests before burst the API where:
    ratelimit-limit: total requests the API can handle
    ratelimit-remaining: remaining requests avilable before exceeded the limmit
    ratelimit-reset: remaining seconds to reset the remaining requests to the total limit
    