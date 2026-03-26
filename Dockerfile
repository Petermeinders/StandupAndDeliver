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

# Copy remaining source and publish
COPY . .
RUN dotnet publish StandupAndDeliver/StandupAndDeliver.csproj -c Release -o /app/publish --no-restore

# Runtime stage — aspnet only, no SDK
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "StandupAndDeliver.dll"]
