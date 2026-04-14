#!/usr/bin/env python3
import argparse
import csv
import logging
import time
from pathlib import Path
import requests
import ssl
import urllib3

class CustomHttpAdapter(requests.adapters.HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        ctx = ssl.create_default_context()
        ctx.options |= 0x4  # ssl.OP_LEGACY_SERVER_CONNECT
        ctx.check_hostname = False
        self.poolmanager = urllib3.poolmanager.PoolManager(
                num_pools=connections, maxsize=maxsize, block=block, ssl_context=ctx)

urllib3.disable_warnings()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out-csv', default='data_pipeline/downloads/wbbse_schools.csv')
    parser.add_argument('--test-run', action='store_true', help='Test mode: stops after 1 district')
    return parser.parse_args()

def get_session():
    session = requests.Session()
    session.mount('https://', CustomHttpAdapter())
    return session

def fetch_pages(session, url_template):
    all_records = []
    page = 1
    limit = 100
    total = -1
    
    while True:
        url = url_template.format(page=page, limit=limit)
        try:
            r = session.get(url, verify=False, timeout=30)
            data = r.json()
        except Exception as e:
            logging.error(f"      Error fetching page {page}: {e}")
            break
        
        records = data.get('records', [])
        if total == -1:
            total = data.get('total', 0)
            
        if not records:
            break
            
        all_records.extend(records)
        logging.info(f"      Fetched page {page} ({len(records)} records). Segment extracted: {len(all_records)} / {total}")
        
        if page * limit >= total:
            break
        page += 1
        time.sleep(0.5)
    return all_records

def fetch_wbbse_schools(out_csv: Path, is_test: bool):
    session = get_session()
    
    r_zones = session.get('https://wbbse.wb.gov.in/Common/GetZoneList', verify=False)
    r_zones.raise_for_status()
    zones = r_zones.json()
    
    all_schools = []
    
    # --- 1. Fetch Junior High Schools (Scraped Globally) ---
    logging.info("Fetching All Junior Schools state-wide...")
    url_tpl = 'https://wbbse.wb.gov.in/Web/GetJuniorSchoolDirectoryList?searchString=&searchType=&zd=LTE=&sm=LTE=&page={page}&limit={limit}'
    juniors = fetch_pages(session, url_tpl)
    for j in juniors:
        j['SchoolDirectoryType'] = 'P' # Mark as Pre/Junior
    all_schools.extend(juniors)
    
    for z in zones:
        z_id = z.get('ZoneId')
        z_name = z.get('ZoneName')
        if not z_id: continue
        logging.info(f"Fetching Zone: {z_name}")

        # --- 2. Fetch Regular High Schools (Scraped by SubDivision) ---
        r_districts = session.get(f'https://wbbse.wb.gov.in/Common/GetDistrictList?zi={z_id}', verify=False)
        districts = r_districts.json()
        
        for d in districts:
            d_id = d.get('DistrictId')
            d_name = d.get('DistrictName')
            if not d_id: continue
            logging.info(f"  Fetching District: {d_name}")
            
            r_subdivs = session.get(f'https://wbbse.wb.gov.in/Common/GetSubDivisionList?di={d_id}', verify=False)
            subdivs = r_subdivs.json()
            
            for sd in subdivs:
                sd_id = sd.get('SubDivisionId')
                sd_name = sd.get('SubDivisionName')
                if not sd_id: continue
                logging.info(f"    Fetching SubDivision: {sd_name} (High Schools)")
                
                url_tpl = f'https://wbbse.wb.gov.in/Web/GetSchoolDirectoryList?searchString=&searchType=&sd={sd_id}&sm=LTE=&page={{page}}&limit={{limit}}'
                high_schools = fetch_pages(session, url_tpl)
                all_schools.extend(high_schools)

            if is_test: break
        if is_test: break

    if not all_schools:
        logging.warning("No schools found!")
        return
        
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = []
    
    exclude_keys = {'View', 'SchoolEditPermissionStatus', 'DeletePermissionCount', 'EntType', 'MigYN'}
    for record in all_schools:
        for k in record.keys():
            if k not in fieldnames and k not in exclude_keys:
                fieldnames.append(k)
                
    with out_csv.open('w', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_schools)
        
    logging.info(f"Saved {len(all_schools)} aggregate schools to {out_csv}")

if __name__ == '__main__':
    args = parse_args()
    fetch_wbbse_schools(Path(args.out_csv), args.test_run)
