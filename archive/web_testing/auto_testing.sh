#!/bin/bash
cd "$(dirname "$0")"
python FDALabel_AutoTest_Script.py
## echo "testing title" | mail -s "hello leihong" leihong.wu@fda.hhs.gov -A full_report/current_testing_report.xlsx
