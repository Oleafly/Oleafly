#!/bin/sh
printf 'docker install script ran, commit %s\n' "${LOAD_SCRIPT_COMMIT_SHA:-none}" >>/stub/log
echo '# Executing docker install script'
cp /stub/bin/docker.real /stub/late/docker
chmod 755 /stub/late/docker
