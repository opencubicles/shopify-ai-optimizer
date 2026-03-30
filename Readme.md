1. First download the theme using shopify cli 

    shopify theme pull --store ella-bella-3505.myshopify.com --theme 181900116287

2. Now upload the duplicate theme
    shopify theme push --store ella-bella-3505.myshopify.com --unpublished --theme "latest-copy-through-cli"
3. Git init the code

4. Ask the user for copies link from page

5. Now run lighthouse URL_PROVIDED_BY_USER \
  --output json \
  --output-path ./lighthouse-report.json \
  --chrome-flags="--headless"

6. Based on report, find the most easy change first which is straight forward to implement. 


7. Implement the change in files

8. git commit that changes
9. upload the changes to unpublished theme for eg. shopify theme push --only sections/tarticle_lp1a.liquid --store ella-bella-3505.myshopify.com --theme 185037226303

10. Now run the lighthouse again and check the score. If score is improved then go to put it in fixes report like what you changes, what it fixed and score or issue is resolved.

11. If you think the page is optimized to an extent now. Ask user to check the score itself otherwise go to step 6.

12. In the end I expect a nice report of all the changes you made and the score improvement.



 
