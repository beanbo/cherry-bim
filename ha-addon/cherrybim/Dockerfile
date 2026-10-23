ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:trixie
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Ядро Cherry BiM — из открытого репозитория: тег или коммит (архив GitHub, git в образе не нужен).
# Зависимости закреплены на версиях, с которыми сервер проверялся 23.10.2026; mcp 2.x несовместим.
ARG CHERRYBIM_REF=v0.3.6

# Системный Python (trixie: 3.13), как в аддоне silero_tts; DejaVu — кириллица на картинке плана.
RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        fonts-dejavu-core \
    && rm -f /usr/lib/python3*/EXTERNALLY-MANAGED \
    && pip3 install --no-cache-dir \
        "cherry-bim[server] @ https://github.com/beanbo/cherry-bim/archive/${CHERRYBIM_REF}.tar.gz" \
        "mcp==1.26.0" \
        "starlette==1.9.0" \
        "uvicorn==0.54.0" \
        "httpx==0.28.1" \
        "websockets==17.3" \
        "pydantic==2.14.1" \
        "pillow==12.3.0" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /
COPY rootfs /
# Файлы приходят с Samba-шары без бита исполнения.
RUN chmod a+x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/s6-rc.d/*/finish

HEALTHCHECK --start-period=60s --interval=30s --timeout=10s --retries=3 \
    CMD bash -c '</dev/tcp/127.0.0.1/8099' || exit 1
