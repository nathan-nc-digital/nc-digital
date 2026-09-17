import {test,expect} from '@playwright/test';

test('public page types retain headings, styling, images and usable mobile layouts',async({page})=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:950});
    for(const path of ['/','/contact/','/services/','/portfolio/','/blog/','/web-design-merthyr-tydfil/','/website-cost-calculator/']){
      const response=await page.goto(path);expect(response?.status()).toBe(200);await expect(page.locator('h1')).toBeVisible();
      expect(await page.locator('link[rel=canonical]').getAttribute('href')).toContain('nc-digital.co.uk');
      expect(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.toLowerCase())).toContain('sora');
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
      const images=page.locator('img[loading=eager], img:not([loading])');
      for(let i=0;i<await images.count();i++)if(await images.nth(i).isVisible())await expect.poll(()=>images.nth(i).evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
      if(path==='/')await page.screenshot({path:`output/crm-build/upgrade-home-${width}.png`,fullPage:true});
    }
  }
  expect(errors).toEqual([]);
});
