#!/bin/bash


lastModificationSeconds=$(date +%s -r /compute001/lwu/projects/FDALabel/fdalabel_testing/full_report/current_testing_report.xlsx)
currentSeconds=$(date +%s)
elapsedSeconds=$((currentSeconds - lastModificationSeconds))

if [[ $elapsedSeconds -lt 87600 ]]
then
	msg="Please find the auto-testing report for FDALabel. Do not respond to this automated email. If you have any questions please contact leihong."
	echo $msg
	echo $msg | \
	mail -s "FDALabel Testing Report" \
	-a /compute001/lwu/projects/FDALabel/fdalabel_testing/full_report/current_testing_report.xlsx \
	-c "Leihong.wu@fda.hhs.gov" "taylor.ingle@fda.hhs.gov" "junshuang.yang@fda.hhs.gov" "hong.fang@fda.hhs.gov" "lan.ying@fda.hhs.gov"
	echo "Process end normal"
else
	msg="File last modified time ("$elapsedSeconds+" seconds) is larger than one day (87600 seconds), auto testing result is not updated \
	Do not respond to this automated email. If you have any questions please contact leihong."
	echo $msg
	echo $msg | \
	mail -s "FDALabel Testing Report - Error" \
	-a /compute001/lwu/projects/FDALabel/fdalabel_testing/full_report/current_testing_report.xlsx \
	"Leihong.wu@fda.hhs.gov" 
fi