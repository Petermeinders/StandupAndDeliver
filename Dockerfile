# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files first for layer caching on restore
COPY StandupAndDeliver.sln ./
COPY StandupAndDeliver/StandupAndDeliver.csproj StandupAndDeliver/
COPY StandupAndDeliver.Client/StandupAndDeliver.Client.csproj StandupAndDeliver.Client/
COPY StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj StandupAndDeliver.Shared/
COPY StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj StandupAndDeliver.Tests/
RUN dotnet restore

# Copy remaining source
COPY . .

# Download Tailwind CLI and build CSS directly (bypasses MSBuild integration)
RUN curl -fsSL -o /tmp/tailwindcss \
      https://github.com/tailwindlabs/tailwindcss/releases/download/v4.2.2/tailwindcss-linux-x64 && \
    chmod +x /tmp/tailwindcss && \
    mkdir -p StandupAndDeliver/wwwroot/css && \
    /tmp/tailwindcss \
      -i StandupAndDeliver.Client/wwwroot/css/app.input.css \
      -o StandupAndDeliver/wwwroot/css/app.css \
      --minify && \
    echo "Tailwind CSS built successfully" && \
    ls -lh StandupAndDeliver/wwwroot/css/

# Publish — skip MSBuild Tailwind target since CSS is already built above
RUN dotnet publish StandupAndDeliver/StandupAndDeliver.csproj \
    -c Release -o /app/publish --no-restore \
    -p:SkipTailwindBuild=true

# Verify CSS made it into the publish output
RUN ls -lh /app/publish/wwwroot/css/ && echo "CSS verified in publish output"

# Workaround: blazor.web.js is missing from Release static assets manifest in .NET 10.
# The file lives in the SDK installation (not NuGet cache) — search the full filesystem.
RUN BLAZOR_WEB_JS=$(find /usr/share/dotnet /root/.nuget -name "blazor.web.js" 2>/dev/null | head -1) && \
    echo "Found blazor.web.js at: $BLAZOR_WEB_JS" && \
    cp "$BLAZOR_WEB_JS" /app/publish/wwwroot/_framework/ && \
    BLAZOR_DIR=$(dirname "$BLAZOR_WEB_JS") && \
    [ -f "$BLAZOR_DIR/blazor.web.js.gz" ] && cp "$BLAZOR_DIR/blazor.web.js.gz" /app/publish/wwwroot/_framework/ || true && \
    [ -f "$BLAZOR_DIR/blazor.web.js.br" ] && cp "$BLAZOR_DIR/blazor.web.js.br" /app/publish/wwwroot/_framework/ || true && \
    echo "Done:" && ls /app/publish/wwwroot/_framework/blazor.web.js*

# Runtime stage — aspnet only, no SDK
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "StandupAndDeliver.dll"]
