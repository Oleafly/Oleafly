#!/bin/sh
printf 'get-docker.sh %s\n' "$*" >>/stub/log
echo '# Executing docker install script'
cp /stub/bin/docker.real /stub/late/docker
chmod 755 /stub/late/docker
